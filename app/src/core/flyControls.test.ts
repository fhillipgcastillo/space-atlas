import { describe, expect, it } from 'vitest';
import { speedForDistance } from './flyControls.js';

const options = { fraction: 0.5, min: 0.001, max: 1e6 };

describe('speedForDistance', () => {
  it('scales linearly with distance from the origin', () => {
    expect(speedForDistance(100, options)).toBeCloseTo(50);
    expect(speedForDistance(1000, options)).toBeCloseTo(500);
  });

  it('keeps a usable speed at the origin', () => {
    expect(speedForDistance(0, options)).toBe(options.min);
  });

  it('clamps to the maximum so a far camera cannot teleport', () => {
    expect(speedForDistance(1e12, options)).toBe(options.max);
  });

  it('never returns a negative speed for a negative input', () => {
    expect(speedForDistance(-500, options)).toBeGreaterThanOrEqual(options.min);
  });

  it('is monotonic across four decades of distance', () => {
    const samples = [1, 10, 100, 1000, 10_000].map((d) => speedForDistance(d, options));
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i]!).toBeGreaterThanOrEqual(samples[i - 1]!);
    }
  });
});
