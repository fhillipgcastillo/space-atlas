import { describe, expect, it } from 'vitest';
import { layerScaleFactor, rescalePosition, selectLayers, type LayerDef } from './stack.js';

const AU = 149597870700;
const LY = 9460730472580800;
const MLY = LY * 1e6;

const layers: LayerDef[] = [
  { key: 'solar-system', url: '/a', unit: 'AU', unitInMetres: AU, minRadius: 0, maxRadius: 100, origin: 'Sun' },
  { key: 'stellar', url: '/b', unit: 'ly', unitInMetres: LY, minRadius: 0.01, maxRadius: 5000, origin: 'Sol' },
  { key: 'local', url: '/c', unit: 'Mly', unitInMetres: MLY, minRadius: 0.3, maxRadius: 300, origin: 'MW' },
];

describe('selectLayers', () => {
  it('picks the innermost layer close to the origin', () => {
    const s = selectLayers(5 * AU, layers);
    expect(s.primary.key).toBe('solar-system');
    expect(s.secondary).toBeNull();
    expect(s.blend).toBe(0);
  });

  it('picks the middle layer well inside its range', () => {
    const s = selectLayers(1000 * LY, layers);
    expect(s.primary.key).toBe('stellar');
    expect(s.secondary).toBeNull();
  });

  it('picks the outermost layer at great distance', () => {
    const s = selectLayers(200 * MLY, layers);
    expect(s.primary.key).toBe('local');
    expect(s.secondary).toBeNull();
  });

  it('blends across the gap between two layers', () => {
    // 5000 ly is the top of the stellar layer, 300000 ly the bottom of local.
    const s = selectLayers(30000 * LY, layers);
    expect(s.primary.key).toBe('stellar');
    expect(s.secondary?.key).toBe('local');
    expect(s.blend).toBeGreaterThan(0);
    expect(s.blend).toBeLessThan(1);
  });

  it('blends in log space so the transition is even across decades', () => {
    // The geometric midpoint of 5000 and 300000 ly should be blend 0.5.
    const midpoint = Math.sqrt(5000 * 300000) * LY;
    expect(selectLayers(midpoint, layers).blend).toBeCloseTo(0.5, 2);
  });

  it('is monotonic: blend never decreases as distance grows', () => {
    let previous = -1;
    for (let d = 5000; d <= 300000; d *= 1.2) {
      const s = selectLayers(d * LY, layers);
      expect(s.blend).toBeGreaterThanOrEqual(previous);
      previous = s.blend;
    }
  });

  it('clamps below the innermost layer rather than returning nothing', () => {
    const s = selectLayers(0, layers);
    expect(s.primary.key).toBe('solar-system');
  });

  it('clamps beyond the outermost layer', () => {
    const s = selectLayers(1e9 * MLY, layers);
    expect(s.primary.key).toBe('local');
    expect(s.secondary).toBeNull();
  });

  it('never returns a blend outside 0 to 1', () => {
    for (const d of [0, AU, LY, 1e4 * LY, 1e5 * LY, MLY, 1e4 * MLY]) {
      const s = selectLayers(d, layers);
      expect(s.blend).toBeGreaterThanOrEqual(0);
      expect(s.blend).toBeLessThanOrEqual(1);
    }
  });
});

describe('rescalePosition', () => {
  it('converts a distance between two units', () => {
    // 1 light-year expressed in AU is about 63241.
    expect(rescalePosition(1, LY, AU)).toBeCloseTo(63241, 0);
  });

  it('round-trips without drift', () => {
    const there = rescalePosition(1234.5, LY, AU);
    expect(rescalePosition(there, AU, LY)).toBeCloseTo(1234.5, 6);
  });

  it('is the identity for the same unit', () => {
    expect(rescalePosition(42, LY, LY)).toBe(42);
  });
});

describe('layerScaleFactor', () => {
  it('is 1 for the active layer itself', () => {
    expect(layerScaleFactor(layers[1]!, layers[1]!)).toBe(1);
  });

  it('shrinks an outer layer into an inner layer active space', () => {
    // A megalight-year is a million light-years, so drawing the local layer
    // inside the stellar layer scales its coordinates up by 1e6.
    expect(layerScaleFactor(layers[2]!, layers[1]!)).toBeCloseTo(1e6, 0);
  });
});

const overlapping: LayerDef[] = [
  { key: 'inner', url: '/i', unit: 'ly', unitInMetres: LY, minRadius: 0.01, maxRadius: 5000, origin: 'Sol' },
  { key: 'mid', url: '/m', unit: 'ly', unitInMetres: LY, minRadius: 3000, maxRadius: 400000, origin: 'Sol' },
  { key: 'outer', url: '/o', unit: 'Mly', unitInMetres: MLY, minRadius: 0.3, maxRadius: 300, origin: 'MW' },
];

describe('selectLayers across overlapping layers', () => {
  it('blends inside an overlap band', () => {
    // inner ends at 5000 ly, mid begins at 3000 ly - they overlap.
    const s = selectLayers(4000 * LY, overlapping);
    expect(s.primary.key).toBe('inner');
    expect(s.secondary?.key).toBe('mid');
    expect(s.blend).toBeGreaterThan(0);
    expect(s.blend).toBeLessThan(1);
  });

  it('reaches the geometric midpoint of an overlap at blend 0.5', () => {
    const midpoint = Math.sqrt(3000 * 5000) * LY;
    expect(selectLayers(midpoint, overlapping).blend).toBeCloseTo(0.5, 2);
  });

  it('is fully the inner layer below the overlap', () => {
    const s = selectLayers(1000 * LY, overlapping);
    expect(s.primary.key).toBe('inner');
    expect(s.secondary).toBeNull();
  });

  it('is fully the middle layer above the first overlap', () => {
    const s = selectLayers(50000 * LY, overlapping);
    expect(s.primary.key).toBe('mid');
    expect(s.secondary).toBeNull();
  });

  it('blends the second overlap into the outer layer', () => {
    const s = selectLayers(350000 * LY, overlapping);
    expect(s.primary.key).toBe('mid');
    expect(s.secondary?.key).toBe('outer');
  });

  it('never returns NaN when two layers exactly touch', () => {
    const touching: LayerDef[] = [
      { ...overlapping[0]!, maxRadius: 5000 },
      { ...overlapping[1]!, minRadius: 5000 },
    ];
    for (const d of [4999, 5000, 5001, 10000]) {
      const s = selectLayers(d * LY, touching);
      expect(Number.isNaN(s.blend)).toBe(false);
      expect(s.blend).toBeGreaterThanOrEqual(0);
      expect(s.blend).toBeLessThanOrEqual(1);
    }
  });

  it('stays monotonic through an overlap', () => {
    let previous = -1;
    for (let d = 3000; d <= 5000; d *= 1.05) {
      const s = selectLayers(d * LY, overlapping);
      if (s.secondary === null) continue;
      expect(s.blend).toBeGreaterThanOrEqual(previous);
      previous = s.blend;
    }
  });
});

describe('selectLayers with a zero lower band edge', () => {
  // The registry already contains minRadius: 0 (the solar system layer), so
  // this is reachable, not hypothetical. log(0) is -Infinity and the resulting
  // NaN blend is not caught by clamping - it would silently hide a layer.
  const zeroEdged: LayerDef[] = [
    { key: 'inner', url: '/i', unit: 'ly', unitInMetres: LY, minRadius: 0.01, maxRadius: 5000, origin: 'Sol' },
    { key: 'outer', url: '/o', unit: 'ly', unitInMetres: LY, minRadius: 0, maxRadius: 400000, origin: 'Sol' },
  ];

  it('never returns NaN', () => {
    for (const d of [1, 1000, 2500, 4999]) {
      const s = selectLayers(d * LY, zeroEdged);
      expect(Number.isNaN(s.blend)).toBe(false);
    }
  });

  it('still produces a usable blend in range', () => {
    const s = selectLayers(1000 * LY, zeroEdged);
    expect(s.blend).toBeGreaterThanOrEqual(0);
    expect(s.blend).toBeLessThanOrEqual(1);
    expect(s.secondary?.key).toBe('outer');
  });

  it('stays monotonic without the logarithm', () => {
    let previous = -1;
    for (const d of [1, 500, 1000, 2500, 4000, 4900]) {
      const s = selectLayers(d * LY, zeroEdged);
      expect(s.blend).toBeGreaterThanOrEqual(previous);
      previous = s.blend;
    }
  });
});
