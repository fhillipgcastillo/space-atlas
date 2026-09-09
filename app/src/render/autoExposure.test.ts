import { describe, expect, it } from 'vitest';
import { TARGET_LUMINANCE, adaptExposure, exposureForLuminance } from './autoExposure.js';

describe('exposureForLuminance', () => {
  it('leaves an already correct scene alone', () => {
    expect(exposureForLuminance(TARGET_LUMINANCE)).toBeCloseTo(1);
  });

  it('dims a scene that is too bright', () => {
    expect(exposureForLuminance(TARGET_LUMINANCE * 4)).toBeCloseTo(0.25);
  });

  it('brightens a scene that is too dark', () => {
    expect(exposureForLuminance(TARGET_LUMINANCE / 4)).toBeCloseTo(4);
  });

  it('does not divide by zero on a black frame', () => {
    const e = exposureForLuminance(0);
    expect(Number.isFinite(e)).toBe(true);
    expect(e).toBeGreaterThan(0);
  });

  it('clamps rather than returning an absurd exposure for a near-black frame', () => {
    // Capped at 16: the honesty dimming ratio compresses toward 1 as exposure
    // rises, so an unbounded ceiling would erode it.
    expect(exposureForLuminance(1e-9)).toBeLessThanOrEqual(16);
  });
});

describe('adaptExposure', () => {
  it('moves toward the desired value', () => {
    const next = adaptExposure(1, 4, 0.1);
    expect(next).toBeGreaterThan(1);
    expect(next).toBeLessThan(4);
  });

  it('covers half the gap in one half-life', () => {
    expect(adaptExposure(0, 1, 0.5, 0.5)).toBeCloseTo(0.5, 2);
  });

  it('is frame rate independent', () => {
    // One 0.4 s step must land where four 0.1 s steps do.
    let stepped = 1;
    for (let i = 0; i < 4; i++) stepped = adaptExposure(stepped, 8, 0.1, 0.5);
    expect(adaptExposure(1, 8, 0.4, 0.5)).toBeCloseTo(stepped, 4);
  });

  it('converges rather than overshooting', () => {
    let e = 1;
    for (let i = 0; i < 200; i++) e = adaptExposure(e, 5, 0.05);
    expect(e).toBeCloseTo(5, 2);
  });

  it('handles a zero or negative timestep without moving backwards', () => {
    expect(adaptExposure(2, 8, 0)).toBeCloseTo(2);
    expect(adaptExposure(2, 8, -1)).toBeCloseTo(2);
  });
});
