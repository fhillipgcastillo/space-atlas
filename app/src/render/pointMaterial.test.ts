import { describe, expect, it, vi } from 'vitest';
import {
  createPointMaterial,
  DEFAULT_FAINT_BOOST,
  DEFAULT_MIN_ALPHA,
  getPointUniform,
  setPointUniform,
} from './pointMaterial.js';

vi.stubGlobal('window', { devicePixelRatio: 1 });

describe('the alpha floor', () => {
  it('is a uniform the shader clamps against, not a literal', () => {
    const material = createPointMaterial(1);
    expect(material.vertexShader).toContain('clamp(stretched, uMinAlpha, 1.0)');
    expect(material.uniforms['uMinAlpha']!.value).toBe(DEFAULT_MIN_ALPHA);
  });

  it('reaches materials created before and after the change', () => {
    const before = createPointMaterial(1);
    setPointUniform('uMinAlpha', 0.005);
    const after = createPointMaterial(1);
    try {
      expect(before.uniforms['uMinAlpha']!.value).toBe(0.005);
      expect(after.uniforms['uMinAlpha']!.value).toBe(0.005);
      expect(getPointUniform('uMinAlpha')).toBe(0.005);
    } finally {
      setPointUniform('uMinAlpha', DEFAULT_MIN_ALPHA);
    }
  });
});

describe('the faint boost', () => {
  it('maps brightness through asinh rather than linearly', () => {
    const material = createPointMaterial(1);
    expect(material.vertexShader).toContain('asinh(gained * uFaintBoost) / asinh(uFaintBoost)');
    expect(material.uniforms['uFaintBoost']!.value).toBe(DEFAULT_FAINT_BOOST);
  });

  it('ships linear by default, so the shipped look is unchanged', () => {
    expect(DEFAULT_FAINT_BOOST).toBe(1);
  });

  it('lifts a faint point far more than a bright one', () => {
    // The shader's arithmetic, evaluated here: the whole point of the stretch is
    // that the ratio to a linear response falls as brightness rises.
    const stretch = (x: number, boost: number): number =>
      Math.asinh(x * boost) / Math.asinh(boost);
    // An explicit boost, not the default: the default is linear on purpose and
    // this test is about the shape of the curve when it is turned on.
    const boost = 120;
    const faintGain = stretch(0.001, boost) / 0.001;
    const brightGain = stretch(0.5, boost) / 0.5;
    expect(faintGain).toBeGreaterThan(10 * brightGain);
    expect(stretch(1, boost)).toBeCloseTo(1, 12);
  });
});
