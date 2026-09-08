import { Group, type Points, RawShaderMaterial } from 'three';
import { MAX_TILE_SLOTS } from '../render/pickIds.js';
import { createTileMesh } from '../render/tileMesh.js';
import { TileCache } from './cache.js';
import type { DecodedTile } from './format.js';
import { TileLoader } from './loader.js';
import { fetchTile, type Tileset } from './tileset.js';
import { nodeScreenSpaceError, selectNodes, type ViewState } from './traversal.js';

export interface TileManagerOptions {
  screenSpaceErrorThreshold: number;
  maxVisibleNodes: number;
  maxInFlight: number;
  gpuByteBudget: number;
}

export const DEFAULT_OPTIONS: TileManagerOptions = {
  screenSpaceErrorThreshold: 160,
  maxVisibleNodes: 384,
  maxInFlight: 8,
  gpuByteBudget: 512 * 1024 * 1024,
};

// 10 bytes of vertex attributes per point, plus the CPU-side copy Three keeps
// alive in the BufferAttribute until the geometry is disposed.
const BYTES_PER_POINT = 20;

export class TileManager {
  readonly group = new Group();
  readonly meshes = new Map<string, Points>();
  /** Picking addresses tiles by slot; the decoded tile is kept for hover lookups. */
  readonly tilesBySlot = new Map<number, { tile: DecodedTile; mesh: Points }>();

  private readonly cache: TileCache<Points>;
  private readonly loader: TileLoader<DecodedTile>;
  private readonly slotByPath = new Map<string, number>();
  private nextSlot = 0;

  constructor(
    private readonly baseUrl: string,
    private readonly tileset: Tileset,
    private readonly material: RawShaderMaterial,
    private readonly options: TileManagerOptions = DEFAULT_OPTIONS,
  ) {
    this.cache = new TileCache<Points>(options.gpuByteBudget);
    this.cache.onEvict = (path, mesh) => {
      this.group.remove(mesh);
      this.meshes.delete(path);
      const slot = mesh.userData['tileSlot'];
      if (typeof slot === 'number' && this.tilesBySlot.get(slot)?.mesh === mesh) {
        this.tilesBySlot.delete(slot);
      }
      this.slotByPath.delete(path);
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

  update(view: ViewState): void {
    const wanted = selectNodes(
      this.tileset.root,
      view,
      this.options.screenSpaceErrorThreshold,
      this.options.maxVisibleNodes,
    );

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
    }
  }

  dispose(): void {
    this.cache.clear();
  }

  private slotFor(path: string): number {
    const existing = this.slotByPath.get(path);
    if (existing !== undefined) return existing;
    // Round-robin, but skipping occupied slots: reusing a live slot would make
    // every hover on the old tile report a point from the new one.
    for (let i = 0; i < MAX_TILE_SLOTS; i++) {
      const slot = (this.nextSlot + i) % MAX_TILE_SLOTS;
      if (this.tilesBySlot.has(slot)) continue;
      this.nextSlot = (slot + 1) % MAX_TILE_SLOTS;
      this.slotByPath.set(path, slot);
      return slot;
    }
    throw new Error(`tile manager: no free pick slot for ${path}`);
  }
}
