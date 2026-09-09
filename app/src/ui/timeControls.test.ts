import { describe, expect, it } from 'vitest';
import { FLAG_MODELED, FLAG_NO_RADIAL_VELOCITY } from '../render/typeFlags.js';
import { sampleTimeStats, timeDisclosure } from './timeControls.js';

const stats = (noRadialVelocityFraction: number, modeledFraction: number) => ({
  noRadialVelocityFraction,
  modeledFraction,
});

describe('timeDisclosure', () => {
  it('names a real percentage rather than a vague qualifier', () => {
    const text = timeDisclosure(stats(0.49, 0));
    expect(text).toContain('49%');
    expect(text.toLowerCase()).not.toContain('some objects');
    expect(text.toLowerCase()).not.toContain('many objects');
  });

  it('says the unmeasured component is transverse only and substituted with zero', () => {
    const text = timeDisclosure(stats(0.49, 0)).toLowerCase();
    expect(text).toContain('no measured radial velocity');
    expect(text).toContain('transverse');
    expect(text).toContain('zero');
  });

  it('mentions the modeled population only when that fraction is above zero', () => {
    expect(timeDisclosure(stats(0.49, 0)).toLowerCase()).not.toContain('modeled');
    expect(timeDisclosure(stats(0.01, 0.98))).toContain('98%');
    expect(timeDisclosure(stats(0.01, 0.98)).toLowerCase()).toContain('modeled');
  });

  it('says the modeled points do not move', () => {
    const text = timeDisclosure(stats(0.4, 0.98)).toLowerCase();
    expect(text).toContain('no kinematics');
    expect(text).toContain('still');
  });

  it('never claims the motion is measured when the radial velocity is mostly missing', () => {
    const text = timeDisclosure(stats(0.49, 0)).toLowerCase();
    expect(text).not.toContain('every catalogued object in view carries a measured');
    expect(text).not.toMatch(/motion is measured|fully measured|measured motion/);
  });

  it('states the plain case only when nothing is missing radial velocity', () => {
    expect(timeDisclosure(stats(0, 0)).toLowerCase()).toContain(
      'every catalogued object in view carries a measured radial velocity',
    );
  });

  it('says nothing about radial velocity when no catalogued object was sampled', () => {
    const text = timeDisclosure(stats(Number.NaN, 1));
    expect(text.toLowerCase()).not.toContain('radial velocity');
    expect(text).toContain('100%');
    expect(text.toLowerCase()).toContain('modeled');
  });

  it('states the million-year limit of linear extrapolation', () => {
    const text = timeDisclosure(stats(0.49, 0.5)).toLowerCase();
    expect(text).toContain('million years');
    expect(text).toContain('extrapolation');
  });

  it('does not round a present population away to zero percent or a mixed one to all', () => {
    expect(timeDisclosure(stats(0.001, 0))).toContain('1%');
    expect(timeDisclosure(stats(0.9994, 0))).toContain('99%');
    expect(timeDisclosure(stats(1, 0))).toContain('100%');
  });

  it('is stable for the same input', () => {
    expect(timeDisclosure(stats(0.49, 0.98))).toBe(timeDisclosure(stats(0.49, 0.98)));
  });

  it('survives out-of-range fractions', () => {
    expect(timeDisclosure(stats(1.4, -0.2))).toContain('100%');
    expect(timeDisclosure(stats(1.4, -0.2)).toLowerCase()).not.toContain('modeled');
  });
});

describe('sampleTimeStats', () => {
  const tile = (pointCount: number, flagAt: (i: number) => number) => ({
    pointCount,
    typeFlags: Uint8Array.from({ length: pointCount }, (_, i) => flagAt(i)),
  });

  it('reports nothing sampled with no tiles', () => {
    const result = sampleTimeStats([]);
    expect(result.sampled).toBe(0);
    expect(result.modeledFraction).toBe(0);
    expect(result.noRadialVelocityFraction).toBeNaN();
  });

  it('leaves the radial-velocity share unknown when everything sampled is modeled', () => {
    const all = tile(1000, () => FLAG_MODELED | FLAG_NO_RADIAL_VELOCITY);
    const result = sampleTimeStats([all]);
    expect(result.catalogued).toBe(0);
    expect(result.noRadialVelocityFraction).toBeNaN();
    expect(result.modeledFraction).toBe(1);
  });

  it('excludes modeled points from the radial-velocity share', () => {
    // Modeled points carry the no-radial-velocity flag but do not move at all,
    // so counting them would overstate how much is drifting transversely.
    const mixed = tile(1000, (i) =>
      i % 2 === 0 ? FLAG_MODELED | FLAG_NO_RADIAL_VELOCITY : 0,
    );
    const result = sampleTimeStats([mixed]);
    expect(result.noRadialVelocityFraction).toBe(0);
    expect(result.modeledFraction).toBeCloseTo(0.5, 1);
  });

  it('recovers a uniform mix within the sampling error', () => {
    const half = tile(100_000, (i) => (i % 2 === 0 ? FLAG_NO_RADIAL_VELOCITY : 0));
    const result = sampleTimeStats([half]);
    expect(result.sampled).toBeGreaterThan(1000);
    expect(result.noRadialVelocityFraction).toBeCloseTo(0.5, 1);
    expect(result.modeledFraction).toBe(0);
  });

  it('counts flags across several tiles', () => {
    const measured = tile(1000, () => 0);
    const modeled = tile(1000, () => FLAG_MODELED);
    expect(sampleTimeStats([measured, modeled]).modeledFraction).toBeCloseTo(0.5, 5);
  });

  it('counts a catalogued point missing radial velocity', () => {
    const result = sampleTimeStats([tile(1000, () => FLAG_NO_RADIAL_VELOCITY)]);
    expect(result.noRadialVelocityFraction).toBe(1);
    expect(result.modeledFraction).toBe(0);
  });
});
