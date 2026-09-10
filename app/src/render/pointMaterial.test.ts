import { describe, expect, it, vi } from 'vitest';
import {
  createPointMaterial,
  DEFAULT_MIN_ALPHA,
  getPointUniform,
  setPointUniform,
} from './pointMaterial.js';

vi.stubGlobal('window', { devicePixelRatio: 1 });

describe('the alpha floor', () => {
  it('is a uniform the shader clamps against, not a literal', () => {
    const material = createPointMaterial(1);
    expect(material.vertexShader).toContain('clamp(brightness * uAlphaScale, uMinAlpha, 1.0)');
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
