import { Group, type Points, RawShaderMaterial } from 'three';
import { sharedSlotPool, type SlotPool } from '../render/pickIds.js';
import { createTileMesh } from '../render/tileMesh.js';
import { TileCache } from './cache.js';
import type { DecodedTile } from './format.js';
import { TileLoader } from './loader.js';
import { fetchTile, type Tileset } from './tileset.js';
import { nodeScreenSpaceError, selectNodesWithFlux, type ViewState } from './traversal.js';

export interface TileManagerOptions {
  screenSpaceErrorThreshold: number;
  maxVisibleNodes: number;
  /** Points a single layer may draw at once, spent highest-error-first. */
  pointBudget: number;
  maxInFlight: number;
  gpuByteBudget: number;
}

const GPU_BYTE_BUDGET = 512 * 1024 * 1024;
const MAX_POINTS_PER_TILE = 65536;

/**
 * Largest selection the byte budget can hold at once. Selecting more tiles than
 * fit makes the LRU evict a tile that is still selected and immediately refetch
 * it, so the loader thrashes and never settles.
 */
export const maxNodesForBudget = (budget: number, bytesPerPoint: number): number =>
  Math.max(1, Math.floor(budget / (MAX_POINTS_PER_TILE * bytesPerPoint)));

export const DEFAULT_OPTIONS: TileManagerOptions = {
  // One pixel of projected point spacing: below that, refining a point cloud
  // adds no resolvable detail. 160 stopped refining as soon as the camera left
  // the root box, collapsing the whole 1705-tile layer to its root subsample.
  screenSpaceErrorThreshold: 1,
  maxVisibleNodes: maxNodesForBudget(GPU_BYTE_BUDGET, 41),
  // Node count is a poor proxy for cost: cosmic-web's eight depth-1 nodes hold
  // 43,000 points each while its twenty-four depth-2 nodes hold 476. Budgeting
  // points bounds the frame at any distance; the priority queue spends it on
  // the highest-error nodes first.
  //
  // Six million rather than the 1.5M first chosen. Starving the budget is what
  // produced the cube-shaped bright region in the Milky Way: refinement stopped
  // mid-level, leaving coarse nodes standing in for 30x their own points, and
  // no compensation survives the alpha and size ceilings at that ratio. At 6M
  // the same view draws every visible tile, the worst weight falls to 4.8, and
  // the measured frame rate is unchanged -- 131 fps either way on an RTX 3060.
  pointBudget: 6_000_000,
  maxInFlight: 8,
  gpuByteBudget: GPU_BYTE_BUDGET,
};

// 10 bytes of GPU attributes, the CPU-side BufferAttribute copy Three keeps
// until dispose, and the DecodedTile retained in tilesBySlot for hover.
const BYTES_PER_POINT = 41;


export class TileManager {
  readonly group = new Group();
  readonly meshes = new Map<string, Points>();
  /** Picking addresses tiles by slot; the decoded tile is kept for hover lookups. */
  readonly tilesBySlot = new Map<number, { tile: DecodedTile; mesh: Points }>();

  private readonly cache: TileCache<Points>;
  private readonly loader: TileLoader<DecodedTile>;
  private readonly slotByPath = new Map<string, number>();
  private readonly fluxWeights = new Map<string, number>();
  private maxVisibleNodes: number;
  private errorThreshold: number;
  private pointBudget: number;

  constructor(
    private readonly baseUrl: string,
    private readonly tileset: Tileset,
    private readonly material: RawShaderMaterial,
    private readonly options: TileManagerOptions = DEFAULT_OPTIONS,
    private readonly slotPool: SlotPool = sharedSlotPool,
  ) {
    this.maxVisibleNodes = options.maxVisibleNodes;
    this.errorThreshold = options.screenSpaceErrorThreshold;
    this.pointBudget = options.pointBudget;
    this.cache = new TileCache<Points>(options.gpuByteBudget);
    this.cache.onEvict = (path, mesh) => {
      this.group.remove(mesh);
      this.meshes.delete(path);
      const slot = mesh.userData['tileSlot'];
      // A reload registers the new mesh under this slot before the old one is
      // evicted, so releasing unconditionally would free a live slot.
      if (typeof slot === 'number' && this.tilesBySlot.get(slot)?.mesh === mesh) {
        this.tilesBySlot.delete(slot);
        this.slotByPath.delete(path);
        this.slotPool.release(slot);
      }
      mesh.geometry.dispose();
      // createTileMesh clones the material per tile; the shared colour-ramp
      // texture it references is not owned by the clone and survives this.
      if (!Array.isArray(mesh.material)) mesh.material.dispose();
      const pickMaterial = mesh.userData['pickMaterial'];
      if (pickMaterial instanceof RawShaderMaterial) pickMaterial.dispose();
      this.loader.forget(path);
    };

    this.loader = new TileLoader<DecodedTile>(
      (path) => fetchTile(this.baseUrl, path),
      options.maxInFlight,
    );
    this.loader.onLoaded = (path, tile) => {
      const mesh = createTileMesh(tile, this.material);
      this.applyFluxWeight(path, mesh);
      const slot = this.slotFor(path);
      mesh.userData['tileSlot'] = slot;
      this.meshes.set(path, mesh);
      this.tilesBySlot.set(slot, { tile, mesh });
      this.group.add(mesh);
      this.cache.set(path, mesh, Math.max(tile.pointCount * BYTES_PER_POINT, 1));
    };
    this.loader.onFailed = (path, error) => {
      console.warn(`tile ${path} failed to load`, error);
    };
  }

  get byteCount(): number {
    return this.cache.byteCount;
  }

  get inFlightCount(): number {
    return this.loader.inFlightCount;
  }

  /** The byte budget is fixed at construction: TileCache takes it as a constructor arg. */
  get gpuByteBudget(): number {
    return this.options.gpuByteBudget;
  }

  getMaxVisibleNodes(): number {
    return this.maxVisibleNodes;
  }

  // Both selection knobs are read fresh on every update, and tiles dropped from
  // the selection stay cached and hidden, so neither can strand a loaded tile.
  setMaxVisibleNodes(value: number): void {
    this.maxVisibleNodes = Math.max(1, Math.floor(value));
  }

  getPointBudget(): number {
    return this.pointBudget;
  }

  setPointBudget(value: number): void {
    this.pointBudget = Math.max(1, Math.floor(value));
  }

  getScreenSpaceErrorThreshold(): number {
    return this.errorThreshold;
  }

  setScreenSpaceErrorThreshold(value: number): void {
    this.errorThreshold = Math.max(value, 0);
  }

  update(view: ViewState): void {
    const selection = selectNodesWithFlux(
      this.tileset.root,
      view,
      this.errorThreshold,
      this.maxVisibleNodes,
      this.pointBudget,
    );

    this.fluxWeights.clear();
    for (const { node, fluxWeight } of selection) this.fluxWeights.set(node.path, fluxWeight);

    const wanted = selection.map((s) => s.node);
    const wantedPaths = new Set(wanted.map((node) => node.path));
    this.loader.retainOnly(wantedPaths);

    for (const node of wanted) {
      if (this.cache.has(node.path)) {
        this.cache.touch(node.path);
        continue;
      }
      const priority = nodeScreenSpaceError(node, view);
      this.loader.enqueue(node.path, Number.isFinite(priority) ? priority : Number.MAX_VALUE);
    }

    // Loaded-but-unselected tiles stay cached and hidden, so backtracking is
    // instant until the byte budget reclaims them.
    for (const [path, mesh] of this.meshes) {
      mesh.visible = wantedPaths.has(path);
      if (mesh.visible) this.applyFluxWeight(path, mesh);
    }
  }

  dispose(): void {
    this.cache.clear();
  }

  // createTileMesh clones the material per tile, and the weight differs per
  // tile, so it can only be written on the clone.
  private applyFluxWeight(path: string, mesh: Points): void {
    if (Array.isArray(mesh.material)) return;
    const uniform = (mesh.material as RawShaderMaterial).uniforms['uFluxWeight'];
    if (uniform) uniform.value = this.fluxWeights.get(path) ?? 1;
  }

  private slotFor(path: string): number {
    const existing = this.slotByPath.get(path);
    if (existing !== undefined) return existing;
    const slot = this.slotPool.acquire();
    this.slotByPath.set(path, slot);
    return slot;
  }
}
