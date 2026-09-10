import { describe, expect, it } from 'vitest';
import { createPickMaterial } from './picking.js';
import { CLASS_BLACK_HOLE } from './typeFlags.js';

const material = createPickMaterial();

// Mirrors the fragment shader's banding so the ordering contract is testable
// without a GL context.
const bandedDepth = (logDepth: number, priority: number): number =>
  (1 - priority + logDepth) / 2;

describe('pick priority', () => {
  it('classifies the black-hole class into the near band', () => {
    expect(material.vertexShader).toContain(`- ${CLASS_BLACK_HOLE}.0) < 0.5 ? 1u : 0u`);
  });

  it('splits the depth range into as many bands as the shader divides by', () => {
    expect(material.fragmentShader).toContain('- vPriority) + depth) / 2.0');
    expect(material.fragmentShader).toContain('clamp(log2(vFragDepth) * uLogDepthBufFC * 0.5');
  });

  it('puts a priority object ahead of a nearer ordinary one', () => {
    expect(bandedDepth(0.9, 1)).toBeLessThan(bandedDepth(0.1, 0));
  });

  it('leaves the bands meeting at one shared value', () => {
    // The far edge of the priority band equals the near edge of the ordinary
    // one, so the two tie only for an object at exactly the far plane.
    expect(bandedDepth(1, 1)).toBe(bandedDepth(0, 0));
  });

  it('keeps the nearest of two objects of the same class', () => {
    expect(bandedDepth(0.25, 0)).toBeLessThan(bandedDepth(0.75, 0));
    expect(bandedDepth(0.25, 1)).toBeLessThan(bandedDepth(0.75, 1));
  });

  it('keeps every band inside the depth range', () => {
    for (const priority of [0, 1]) {
      for (const depth of [0, 0.5, 1]) {
        expect(bandedDepth(depth, priority)).toBeGreaterThanOrEqual(0);
        expect(bandedDepth(depth, priority)).toBeLessThanOrEqual(1);
      }
    }
  });
});
