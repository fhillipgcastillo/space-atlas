import { describe, expect, it, vi } from 'vitest';
import { TileLoader } from './loader.js';

const deferred = () => {
  let resolve!: (value: unknown) => void;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

describe('TileLoader', () => {
  it('never exceeds the in-flight cap', () => {
    const pending = Array.from({ length: 10 }, deferred);
    let index = 0;
    const loader = new TileLoader(() => pending[index++]!.promise, 3);

    for (let i = 0; i < 10; i++) loader.enqueue(`t${i}`, i);

    expect(loader.inFlightCount).toBe(3);
  });

  it('starts the highest priority request first', () => {
    const fetchFn = vi.fn(() => new Promise(() => {}));
    const loader = new TileLoader(fetchFn, 1);

    loader.enqueue('low', 1);
    loader.enqueue('high', 99);
    loader.enqueue('mid', 50);

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn).toHaveBeenCalledWith('low');
  });

  it('picks the highest priority from the queue as slots free up', async () => {
    const first = deferred();
    const fetchFn = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValue(new Promise(() => {}));
    const loader = new TileLoader(fetchFn as never, 1);

    loader.enqueue('a', 1);
    loader.enqueue('b', 5);
    loader.enqueue('c', 90);
    first.resolve(null);
    await Promise.resolve();
    await Promise.resolve();

    expect(fetchFn).toHaveBeenLastCalledWith('c');
  });

  it('drops queued requests that retainOnly no longer wants', () => {
    const fetchFn = vi.fn(() => new Promise(() => {}));
    const loader = new TileLoader(fetchFn, 1);

    loader.enqueue('keep', 1);
    loader.enqueue('drop', 2);
    loader.retainOnly(new Set(['keep']));

    expect(loader.queuedPaths).toEqual([]);
  });

  it('does not enqueue the same path twice', () => {
    const fetchFn = vi.fn(() => new Promise(() => {}));
    const loader = new TileLoader(fetchFn, 1);

    loader.enqueue('a', 1);
    loader.enqueue('a', 5);

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(loader.queuedPaths).toEqual([]);
  });

  it('retries a failed path on a later enqueue', async () => {
    const fetchFn = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockReturnValue(new Promise(() => {}));
    const loader = new TileLoader(fetchFn as never, 1);
    const onFailed = vi.fn();
    loader.onFailed = onFailed;

    loader.enqueue('a', 1);
    await Promise.resolve();
    await Promise.resolve();

    expect(onFailed).toHaveBeenCalledTimes(1);
    expect(loader.inFlightCount).toBe(0);

    loader.enqueue('a', 1);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});
