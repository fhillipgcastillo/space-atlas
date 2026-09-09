import { describe, expect, it } from 'vitest';
import { formatDistance, layerDisplayName } from './scaleHud.js';

const AU = 149597870700;
const LY = 9460730472580800;
const MLY = LY * 1e6;
const GLY = LY * 1e9;

const UNIT = /(AU|ly|Mly|Gly)$/;

describe('formatDistance', () => {
  it('uses AU below one light-year', () => {
    expect(formatDistance(AU)).toBe('1.0 AU');
    expect(formatDistance(39.5 * AU)).toBe('39.5 AU');
    expect(formatDistance(LY * 0.999)).toMatch(/ AU$/);
  });

  it('switches to light-years at one light-year', () => {
    expect(formatDistance(LY)).toBe('1.0 ly');
    expect(formatDistance(LY * 0.9999999)).toMatch(/ AU$/);
  });

  it('reads nearby stars and the galactic centre naturally', () => {
    expect(formatDistance(4.2465 * LY)).toBe('4.2 ly');
    expect(formatDistance(26670 * LY)).toBe('26,670 ly');
  });

  it('switches to megalight-years at one million light-years', () => {
    expect(formatDistance(999999 * LY)).toMatch(/ ly$/);
    expect(formatDistance(1e6 * LY)).toBe('1.0 Mly');
    expect(formatDistance(2.5 * MLY)).toBe('2.5 Mly');
  });

  it('switches to gigalight-years past a thousand megalight-years', () => {
    expect(formatDistance(999 * MLY)).toBe('999 Mly');
    expect(formatDistance(GLY)).toBe('1.0 Gly');
    expect(formatDistance(13.8 * GLY)).toBe('13.8 Gly');
  });

  it('separates thousands', () => {
    expect(formatDistance(50000 * AU)).toBe('50,000 AU');
    expect(formatDistance(26670 * LY)).toContain(',');
  });

  it('never uses scientific notation across the whole span', () => {
    for (let metres = AU; metres <= 14 * GLY; metres *= 1.1) {
      const text = formatDistance(metres);
      expect(text).not.toMatch(/[eE][+-]?\d/);
      expect(text).toMatch(UNIT);
    }
  });

  it('degrades sensibly at zero and below', () => {
    expect(formatDistance(0)).toBe('0 AU');
    expect(formatDistance(-1e12)).toBe('0 AU');
    expect(formatDistance(Number.NaN)).toBe('0 AU');
    expect(formatDistance(Number.POSITIVE_INFINITY)).toBe('0 AU');
  });

  it('keeps sub-AU distances readable rather than rounding them away', () => {
    expect(formatDistance(0.5 * AU)).toBe('0.5 AU');
    expect(formatDistance(0.0012 * AU)).toBe('0.0012 AU');
    expect(formatDistance(1e-9 * AU)).toMatch(UNIT);
    expect(formatDistance(1e-9 * AU)).not.toMatch(/[eE][+-]?\d/);
  });

  it('always carries a unit', () => {
    for (const metres of [0, 1, AU, LY, MLY, GLY, 1e40]) {
      expect(formatDistance(metres)).toMatch(UNIT);
    }
  });
});

describe('layerDisplayName', () => {
  it('turns a layer key into a readable name', () => {
    expect(layerDisplayName('milky-way')).toBe('Milky Way');
    expect(layerDisplayName('stellar-neighbourhood')).toBe('Stellar Neighbourhood');
    expect(layerDisplayName('cosmic-web')).toBe('Cosmic Web');
  });
});
