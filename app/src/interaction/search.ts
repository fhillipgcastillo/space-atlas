import { Vector3 } from 'three';
import { loadNames } from '../layers/sidecars.js';
import type { LayerDef } from '../layers/stack.js';
import { dequantizePosition } from '../tiles/format.js';
import { fetchTile, fetchTileset, type TileNode } from '../tiles/tileset.js';

export interface SearchEntry {
  name: string;
  layerKey: string;
  localId: number;
  position: [number, number, number];
}

const DEFAULT_LIMIT = 10;

/** One unit of the target's own layer: 1 AU from a planet, 1 Mly from a galaxy. */
const VIEWING_DISTANCE_UNITS = 1;

const FLIGHT_SECONDS = 1.6;

export function search(
  index: SearchEntry[],
  query: string,
  limit: number = DEFAULT_LIMIT,
): SearchEntry[] {
  const needle = query.trim().toLowerCase();
  if (needle === '' || limit <= 0) return [];

  const hits: { entry: SearchEntry; rank: number; at: number; order: number }[] = [];
  for (let order = 0; order < index.length; order++) {
    const entry = index[order]!;
    const name = entry.name.toLowerCase();
    const at = name.indexOf(needle);
    if (at === -1) continue;
    hits.push({ entry, rank: name === needle ? 0 : at === 0 ? 1 : 2, at, order });
  }

  hits.sort(
    (a, b) =>
      a.rank - b.rank ||
      a.at - b.at ||
      a.entry.name.length - b.entry.name.length ||
      a.order - b.order,
  );
  return hits.slice(0, limit).map((hit) => hit.entry);
}

export async function buildSearchIndex(
  layers: LayerDef[],
  onLayer?: (entries: SearchEntry[]) => void,
): Promise<SearchEntry[]> {
  const perLayer = await Promise.all(
    layers.map(async (layer) => {
      const entries = await indexLayer(layer);
      if (entries.length > 0) onLayer?.(entries);
      return entries;
    }),
  );
  return perLayer.flat();
}

// A localId indexes the layer's identifier table, not a tile, so the only way
// to place a named object is to walk the tiles until it turns up. Layers
// without a names.json - the 32.7M-object stellar layer - fetch nothing at all,
// and the walk stops the moment every name has a position.
async function indexLayer(layer: LayerDef): Promise<SearchEntry[]> {
  const names = await loadNames(layer.url);
  if (names.size === 0) return [];

  const tileset = await fetchTileset(layer.url).catch((error: unknown) => {
    console.warn(`search: no tileset for ${layer.key}`, error);
    return undefined;
  });
  if (!tileset) return [];

  const wanted = new Set(names.keys());
  const entries: SearchEntry[] = [];
  const queue: TileNode[] = [tileset.root];
  const scratch = new Float64Array(3);

  while (queue.length > 0 && wanted.size > 0) {
    const node = queue.shift()!;
    queue.push(...node.children);
    const tile = await fetchTile(layer.url, node.path).catch((error: unknown) => {
      console.warn(`search: tile ${node.path} of ${layer.key} unavailable`, error);
      return undefined;
    });
    if (!tile) continue;

    for (let i = 0; i < tile.pointCount; i++) {
      const localId = tile.localId[i]!;
      if (!wanted.has(localId)) continue;
      wanted.delete(localId);
      const name = names.get(localId);
      if (name === undefined || name === '') continue;
      dequantizePosition(tile, i, scratch);
      entries.push({
        name,
        layerKey: layer.key,
        localId,
        position: [scratch[0]!, scratch[1]!, scratch[2]!],
      });
    }
  }
  return entries;
}

export function viewingDistanceMetres(layer: LayerDef): number {
  return VIEWING_DISTANCE_UNITS * layer.unitInMetres;
}

export interface FlyToCamera {
  position: Vector3;
  lookAt: (x: number, y: number, z: number) => void;
}

// Everything here is held in metres. The camera lives in the active layer's
// units and main.ts rescales it at every handover; converting out of metres on
// each frame reproduces that conversion exactly instead of fighting it.
export class FlyTo {
  private readonly target = new Vector3();
  private readonly direction = new Vector3(0, 0, 1);
  private readonly scratch = new Vector3();
  private startDistance = 0;
  private endDistance = 0;
  private elapsed = 0;
  private running = false;

  get active(): boolean {
    return this.running;
  }

  start(entry: SearchEntry, layer: LayerDef, camera: FlyToCamera, activeLayer: LayerDef): void {
    this.target.fromArray(entry.position).multiplyScalar(layer.unitInMetres);
    this.direction
      .copy(camera.position)
      .multiplyScalar(activeLayer.unitInMetres)
      .sub(this.target);
    this.endDistance = viewingDistanceMetres(layer);
    this.startDistance = this.direction.length();
    if (this.startDistance > 0) {
      this.direction.divideScalar(this.startDistance);
    } else {
      // Already on top of the target: back off along an arbitrary axis.
      this.direction.set(0, 0, 1);
      this.startDistance = this.endDistance;
    }
    this.elapsed = 0;
    this.running = true;
  }

  cancel(): void {
    this.running = false;
  }

  update(dtSeconds: number, camera: FlyToCamera, activeLayer: LayerDef): void {
    if (!this.running) return;
    this.elapsed = Math.min(this.elapsed + Math.max(dtSeconds, 0), FLIGHT_SECONDS);
    const t = this.elapsed / FLIGHT_SECONDS;
    const eased = t * t * (3 - 2 * t);
    // Geometric, not linear: the approach spans decades of distance and a
    // linear ramp would spend the whole flight in the last percent of it.
    const distance = this.startDistance * (this.endDistance / this.startDistance) ** eased;

    camera.position
      .copy(this.direction)
      .multiplyScalar(distance)
      .add(this.target)
      .divideScalar(activeLayer.unitInMetres);
    this.scratch.copy(this.target).divideScalar(activeLayer.unitInMetres);
    camera.lookAt(this.scratch.x, this.scratch.y, this.scratch.z);

    if (this.elapsed >= FLIGHT_SECONDS) this.running = false;
  }
}
