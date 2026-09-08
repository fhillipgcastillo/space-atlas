import { describe, expect, it } from 'vitest';
import { buildColourRamp, colourAt } from './colourRamp.js';

describe('colourAt', () => {
  it('is blue-dominant at the hot end', () => {
    const [r, , b] = colourAt(0);
    expect(b).toBeGreaterThan(r);
  });

  it('is red-dominant at the cool end', () => {
    const [r, , b] = colourAt(1);
    expect(r).toBeGreaterThan(b);
  });

  it('is near-neutral in the middle', () => {
    const [r, g, b] = colourAt(0.45);
    expect(Math.abs(r - b)).toBeLessThan(0.35);
    expect(g).toBeGreaterThan(0.5);
  });

  it('stays in gamut across the whole range', () => {
    for (let i = 0; i <= 100; i++) {
      for (const channel of colourAt(i / 100)) {
        expect(channel).toBeGreaterThanOrEqual(0);
        expect(channel).toBeLessThanOrEqual(1);
      }
    }
  });

  it('clamps out-of-range input rather than extrapolating', () => {
    expect(colourAt(-5)).toEqual(colourAt(0));
    expect(colourAt(5)).toEqual(colourAt(1));
  });
});

describe('buildColourRamp', () => {
  it('produces four bytes per texel', () => {
    expect(buildColourRamp(256).length).toBe(256 * 4);
  });

  it('makes every texel opaque', () => {
    const ramp = buildColourRamp(8);
    for (let i = 0; i < 8; i++) {
      expect(ramp[i * 4 + 3]).toBe(255);
    }
  });
});
