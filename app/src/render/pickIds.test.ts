import { describe, expect, it } from 'vitest';
import {
  decodePickId,
  encodePickId,
  MAX_TILE_SLOTS,
  MAX_VERTICES_PER_TILE,
  SlotPool,
} from './pickIds.js';

const toRgba = (id: number): Uint8Array =>
  new Uint8Array([id & 255, (id >>> 8) & 255, (id >>> 16) & 255, (id >>> 24) & 255]);

describe('pick identifiers', () => {
  it('reserves twenty bits for the vertex index and eleven for the tile slot', () => {
    expect(MAX_VERTICES_PER_TILE).toBe(1 << 20);
    expect(MAX_TILE_SLOTS).toBe(1 << 11);
  });

  it('round-trips through the RGBA encoding', () => {
    for (const [slot, vertex] of [
      [0, 0],
      [1, 1],
      [7, 65535],
      [MAX_TILE_SLOTS - 1, MAX_VERTICES_PER_TILE - 1],
    ]) {
      expect(decodePickId(toRgba(encodePickId(slot!, vertex!) + 1))).toEqual({
        tileSlot: slot,
        vertexIndex: vertex,
      });
    }
  });

  it('treats an all-zero readback as background', () => {
    expect(decodePickId(new Uint8Array([0, 0, 0, 0]))).toBeNull();
  });

  it('distinguishes background from the first point of the first tile', () => {
    expect(decodePickId(toRgba(encodePickId(0, 0) + 1))).toEqual({ tileSlot: 0, vertexIndex: 0 });
  });

  it('rejects a slot or index beyond the encoding capacity', () => {
    expect(() => encodePickId(MAX_TILE_SLOTS, 0)).toThrow(/slot/i);
    expect(() => encodePickId(-1, 0)).toThrow(/slot/i);
    expect(() => encodePickId(0, MAX_VERTICES_PER_TILE)).toThrow(/vertex/i);
    expect(() => encodePickId(0, -1)).toThrow(/vertex/i);
  });

  it('keeps the largest identifier plus one inside an unsigned 32-bit word', () => {
    const largest = encodePickId(MAX_TILE_SLOTS - 1, MAX_VERTICES_PER_TILE - 1) + 1;
    expect(largest).toBe(2 ** 31);
    expect(largest).toBeLessThanOrEqual(0xffffffff);
  });

  it('reads from an offset inside a larger buffer', () => {
    const buffer = new Uint8Array(16);
    buffer.set(toRgba(encodePickId(3, 9) + 1), 8);
    expect(decodePickId(buffer, 8)).toEqual({ tileSlot: 3, vertexIndex: 9 });
  });
});

describe('the slot pool', () => {
  it('never hands the same slot to two holders', () => {
    const pool = new SlotPool();
    const slots = Array.from({ length: 100 }, () => pool.acquire());
    expect(new Set(slots).size).toBe(100);
    expect(pool.inUse).toBe(100);
  });

  it('hands out slots the encoding accepts', () => {
    const pool = new SlotPool();
    for (let i = 0; i < 64; i++) expect(() => encodePickId(pool.acquire(), 0)).not.toThrow();
  });

  it('recycles released slots oldest first', () => {
    const pool = new SlotPool();
    const [a, b, c] = [pool.acquire(), pool.acquire(), pool.acquire()];
    pool.release(a!);
    pool.release(b!);
    expect(pool.acquire()).toBe(a);
    expect(pool.acquire()).toBe(b);
    expect(pool.acquire()).not.toBe(c);
  });

  it('ignores a double release rather than duplicating the slot', () => {
    const pool = new SlotPool();
    const slot = pool.acquire();
    pool.release(slot);
    pool.release(slot);
    expect(pool.acquire()).toBe(slot);
    expect(pool.acquire()).not.toBe(slot);
  });

  it('refuses to wrap once every slot is in use', () => {
    const pool = new SlotPool();
    for (let i = 0; i < MAX_TILE_SLOTS; i++) pool.acquire();
    expect(() => pool.acquire()).toThrow(/exhausted/i);
  });
});
