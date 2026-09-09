import { describe, expect, it } from 'vitest';
import {
  clampYears,
  formatYears,
  getTimeYears,
  MAX_YEARS,
  MIN_YEARS,
  setTimeYears,
  velocityScaleForLayer,
} from './timeline.js';

const AU_IN_METRES = 149597870700;
const LY_IN_METRES = 9460730472580800;
const MLY_IN_METRES = LY_IN_METRES * 1e6;

describe('clampYears', () => {
  it('passes both bounds through unchanged', () => {
    expect(clampYears(MAX_YEARS)).toBe(MAX_YEARS);
    expect(clampYears(MIN_YEARS)).toBe(MIN_YEARS);
    expect(clampYears(0)).toBe(0);
  });

  it('clamps beyond the bounds', () => {
    expect(clampYears(MAX_YEARS + 1)).toBe(MAX_YEARS);
    expect(clampYears(1e12)).toBe(MAX_YEARS);
    expect(clampYears(MIN_YEARS - 1)).toBe(MIN_YEARS);
    expect(clampYears(-1e12)).toBe(MIN_YEARS);
  });

  it('treats a non-finite input as present day', () => {
    expect(clampYears(Number.NaN)).toBe(0);
    expect(clampYears(Number.POSITIVE_INFINITY)).toBe(MAX_YEARS);
  });
});

describe('formatYears', () => {
  it('names present day at zero', () => {
    expect(formatYears(0)).toBe('present day');
    expect(formatYears(0.4)).toBe('present day');
  });

  it('separates thousands and signs the direction', () => {
    expect(formatYears(12_400)).toBe('+12,400 years');
    expect(formatYears(-340_000)).toBe('−340,000 years');
    expect(formatYears(1)).toBe('+1 year');
    expect(formatYears(-1)).toBe('−1 year');
  });

  it('never falls back to scientific notation at the bounds', () => {
    expect(formatYears(MAX_YEARS)).toBe('+1,000,000 years');
    expect(formatYears(MIN_YEARS)).toBe('−1,000,000 years');
  });
});

describe('velocityScaleForLayer', () => {
  // 30 km/s for one Julian year is 30e3 * 31_557_600 m = 9.46728e11 m.
  const DRIFT_METRES_30_KM_S = 9.46728e11;

  it('converts 30 km/s into 6.3285 AU per year', () => {
    expect(velocityScaleForLayer(AU_IN_METRES) * 30).toBeCloseTo(
      DRIFT_METRES_30_KM_S / AU_IN_METRES,
      9,
    );
    expect(velocityScaleForLayer(AU_IN_METRES) * 30).toBeCloseTo(6.3284858, 6);
  });

  it('converts 30 km/s into 1.00069e-4 light-years per year', () => {
    expect(velocityScaleForLayer(LY_IN_METRES) * 30).toBeCloseTo(
      DRIFT_METRES_30_KM_S / LY_IN_METRES,
      15,
    );
    expect(velocityScaleForLayer(LY_IN_METRES) * 30).toBeCloseTo(1.0006923e-4, 10);
  });

  it('converts 30 km/s into 1.00069e-10 megalight-years per year', () => {
    expect(velocityScaleForLayer(MLY_IN_METRES) * 30).toBeCloseTo(
      DRIFT_METRES_30_KM_S / MLY_IN_METRES,
      21,
    );
    // toBeCloseTo compares absolute difference, so scale into a range it can judge.
    expect(velocityScaleForLayer(MLY_IN_METRES) * 30 * 1e10).toBeCloseTo(1.0006923, 6);
  });

  // Barnard's Star: 10.3577 arcsec/yr at 1.8266 pc is a transverse 89.687 km/s.
  // One arcsec of parallax angle at one parsec subtends exactly one AU, so the
  // yearly drift must come back as 10.3577 * 1.8266 = 18.9194 AU.
  it('reproduces the proper motion of Barnard’s Star in AU per year', () => {
    const vTanKmS = 4.740470446 * 10.3577 * 1.8266;
    expect(velocityScaleForLayer(AU_IN_METRES) * vTanKmS).toBeCloseTo(10.3577 * 1.8266, 6);
  });

  // 1 pc per million years is 0.9778 km/s, so 1 km/s covers 1.0227 pc = 3.3356 ly.
  it('reproduces one parsec per million years at 0.9778 km/s', () => {
    const PC_IN_LY = 3.0856775814913673e16 / LY_IN_METRES;
    expect(velocityScaleForLayer(LY_IN_METRES) * 0.9777922 * 1e6).toBeCloseTo(PC_IN_LY, 6);
    expect(velocityScaleForLayer(LY_IN_METRES) * 1 * 1e6).toBeCloseTo(3.3356410, 6);
  });

  it('keeps the megalight-year scale exactly a millionth of the light-year one', () => {
    expect(velocityScaleForLayer(LY_IN_METRES) / velocityScaleForLayer(MLY_IN_METRES)).toBeCloseTo(
      1e6,
      3,
    );
  });
});

describe('the shared clock', () => {
  it('clamps what it stores and reads back the clamped value', () => {
    expect(setTimeYears(5000)).toBe(5000);
    expect(getTimeYears()).toBe(5000);
    expect(setTimeYears(9e9)).toBe(MAX_YEARS);
    expect(getTimeYears()).toBe(MAX_YEARS);
    setTimeYears(0);
    expect(getTimeYears()).toBe(0);
  });
});
