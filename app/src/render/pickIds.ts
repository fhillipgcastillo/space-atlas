export const VERTEX_BITS = 20;
export const MAX_VERTICES_PER_TILE = 1 << VERTEX_BITS;
// One bit is reserved so that id + 1 still fits in an unsigned 32-bit word.
export const MAX_TILE_SLOTS = 1 << (31 - VERTEX_BITS);

export interface PickId {
  tileSlot: number;
  vertexIndex: number;
}

export function encodePickId(tileSlot: number, vertexIndex: number): number {
  if (!Number.isInteger(tileSlot) || tileSlot < 0 || tileSlot >= MAX_TILE_SLOTS) {
    throw new Error(`pick id: tile slot ${tileSlot} out of range`);
  }
  if (!Number.isInteger(vertexIndex) || vertexIndex < 0 || vertexIndex >= MAX_VERTICES_PER_TILE) {
    throw new Error(`pick id: vertex index ${vertexIndex} out of range`);
  }
  return tileSlot * MAX_VERTICES_PER_TILE + vertexIndex;
}

/** Decodes a stored id, which is always the real id plus one so zero means background. */
export function decodePickId(rgba: Uint8Array, offset = 0): PickId | null {
  const stored =
    ((rgba[offset] ?? 0) |
      ((rgba[offset + 1] ?? 0) << 8) |
      ((rgba[offset + 2] ?? 0) << 16) |
      ((rgba[offset + 3] ?? 0) << 24)) >>>
    0;
  if (stored === 0) return null;

  const id = stored - 1;
  return {
    tileSlot: Math.floor(id / MAX_VERTICES_PER_TILE),
    vertexIndex: id % MAX_VERTICES_PER_TILE,
  };
}

/**
 * Hands out pick slots. One pool is shared by every tile manager: the picking
 * pass draws all visible layers into one target, so a slot has to identify the
 * tile across the whole scene, not within one manager.
 */
export class SlotPool {
  private next = 0;
  private readonly freeQueue: number[] = [];
  private readonly freeSet = new Set<number>();

  /** Slots currently held by a caller. */
  get inUse(): number {
    return this.next - this.freeQueue.length;
  }

  acquire(): number {
    const recycled = this.freeQueue.shift();
    if (recycled !== undefined) {
      this.freeSet.delete(recycled);
      return recycled;
    }
    if (this.next >= MAX_TILE_SLOTS) {
      throw new Error(`pick slots exhausted: all ${MAX_TILE_SLOTS} are in use`);
    }
    return this.next++;
  }

  release(slot: number): void {
    if (slot < 0 || slot >= this.next || this.freeSet.has(slot)) return;
    this.freeSet.add(slot);
    // Released slots go to the back: a pick buffer read a frame late then
    // resolves against nothing rather than against a freshly loaded tile.
    this.freeQueue.push(slot);
  }
}

export const sharedSlotPool = new SlotPool();
