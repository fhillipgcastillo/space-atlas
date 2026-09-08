import { describe, expect, it } from 'vitest';
import { opacityForBlend } from './layerRenderer.js';

describe('opacityForBlend', () => {
  it('shows the primary fully when there is no transition', () => {
    expect(opacityForBlend('primary', 0)).toBe(1);
    expect(opacityForBlend('secondary', 0)).toBe(0);
  });

  it('hands over completely at the end of the band', () => {
    expect(opacityForBlend('primary', 1)).toBe(0);
    expect(opacityForBlend('secondary', 1)).toBe(1);
  });

  it('crosses over at the midpoint', () => {
    expect(opacityForBlend('primary', 0.5)).toBeCloseTo(0.5);
    expect(opacityForBlend('secondary', 0.5)).toBeCloseTo(0.5);
  });

  it('keeps total brightness roughly constant across the band', () => {
    // Additive blending means the two opacities summing to 1 avoids a bright
    // or dark seam midway through the transition.
    for (let b = 0; b <= 1; b += 0.1) {
      expect(opacityForBlend('primary', b) + opacityForBlend('secondary', b)).toBeCloseTo(1, 6);
    }
  });

  it('never returns a value outside 0 to 1', () => {
    for (const b of [-1, 0, 0.3, 1, 2]) {
      for (const role of ['primary', 'secondary'] as const) {
        const v = opacityForBlend(role, b);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });
});
