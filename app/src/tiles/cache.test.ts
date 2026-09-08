import { describe, expect, it, vi } from 'vitest';
import { TileCache } from './cache.js';

describe('TileCache', () => {
  it('evicts the least recently used entry when the budget is exceeded', () => {
    const cache = new TileCache<string>(100);
    cache.set('a', 'A', 40);
    cache.set('b', 'B', 40);
    cache.touch('a');
    cache.set('c', 'C', 40);

    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBe('A');
    expect(cache.get('c')).toBe('C');
  });

  it('keeps the byte count within budget', () => {
    const cache = new TileCache<string>(100);
    for (let i = 0; i < 20; i++) cache.set(`k${i}`, 'v', 30);
    expect(cache.byteCount).toBeLessThanOrEqual(100);
  });

  it('calls onEvict exactly once per evicted entry so GPU buffers get freed', () => {
    const cache = new TileCache<string>(50);
    const onEvict = vi.fn();
    cache.onEvict = onEvict;
    cache.set('a', 'A', 40);
    cache.set('b', 'B', 40);

    expect(onEvict).toHaveBeenCalledTimes(1);
    expect(onEvict).toHaveBeenCalledWith('a', 'A');
  });

  it('a repeated set replaces rather than double-counting', () => {
    const cache = new TileCache<string>(1000);
    cache.set('a', 'A', 40);
    cache.set('a', 'A2', 60);
    expect(cache.byteCount).toBe(60);
    expect(cache.get('a')).toBe('A2');
  });

  it('accepts an entry larger than the budget rather than looping forever', () => {
    const cache = new TileCache<string>(10);
    cache.set('big', 'B', 999);
    expect(cache.get('big')).toBe('B');
  });
});
