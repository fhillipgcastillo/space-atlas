import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { decodeFloat16, decodeTile, dequantizePosition } from './format.js';

const fixturePath = (name: string) =>
  fileURLToPath(new URL(`../../../tests/fixtures/${name}`, import.meta.url));

interface Expected {
  pointCount: number;
  bboxMin: number[];
  bboxMax: number[];
  position: number[][];
  velocity: number[][];
  colorIndex: number[];
  absMag: number[];
  typeFlags: number[];
  localId: number[];
}

const loadFixture = (name: string): { buffer: ArrayBuffer; expected: Expected } => {
  const blob = readFileSync(fixturePath(`${name}.bin`));
  return {
    buffer: blob.buffer.slice(blob.byteOffset, blob.byteOffset + blob.byteLength) as ArrayBuffer,
    expected: JSON.parse(readFileSync(fixturePath(`${name}.json`), 'utf-8')) as Expected,
  };
};

/**
 * Both fixtures run the identical assertions, and the odd one is the point.
 * At 64 points every attribute block length is already a multiple of 4, so the
 * format's padding rule is never exercised - both codecs could disagree about
 * alignment and this suite would still pass, which is precisely the silent
 * drift it exists to catch. At 63 points, five of the six blocks need padding.
 */
describe.each([
  ['aligned fixture (64 points, no padding)', 'contract-tile'],
  ['odd fixture (63 points, padding after five blocks)', 'contract-tile-odd'],
])('decodeTile - %s', (_label, fixtureName) => {
  const { buffer, expected } = loadFixture(fixtureName);
  const tile = decodeTile(buffer);

  it('reads the header', () => {
    expect(tile.pointCount).toBe(expected.pointCount);
    expect(Array.from(tile.bboxMin)).toEqual(expected.bboxMin);
    expect(Array.from(tile.bboxMax)).toEqual(expected.bboxMax);
  });

  it('reads exact-typed attributes byte-for-byte', () => {
    expect(Array.from(tile.colorIndex)).toEqual(expected.colorIndex);
    expect(Array.from(tile.typeFlags)).toEqual(expected.typeFlags);
    expect(Array.from(tile.localId)).toEqual(expected.localId);
  });

  it('dequantizes positions within half a quantization step', () => {
    const out = new Float64Array(3);
    for (let i = 0; i < tile.pointCount; i++) {
      dequantizePosition(tile, i, out);
      for (let axis = 0; axis < 3; axis++) {
        const step = (expected.bboxMax[axis]! - expected.bboxMin[axis]!) / 131070;
        expect(Math.abs(out[axis]! - expected.position[i]![axis]!)).toBeLessThanOrEqual(
          step + 1e-9,
        );
      }
    }
  });

  it('decodes float16 attributes to the values Python wrote', () => {
    for (let i = 0; i < tile.pointCount; i++) {
      expect(decodeFloat16(tile.absMag[i]!)).toBeCloseTo(expected.absMag[i]!, 5);
      for (let axis = 0; axis < 3; axis++) {
        expect(decodeFloat16(tile.velocity[i * 3 + axis]!)).toBeCloseTo(
          expected.velocity[i]![axis]!,
          5,
        );
      }
    }
  });

  it('rejects a tile with the wrong magic', () => {
    const corrupted = buffer.slice(0);
    new Uint8Array(corrupted).set([88, 88, 88, 88], 0);
    expect(() => decodeTile(corrupted)).toThrow(/magic/i);
  });
});

describe('padding coverage', () => {
  it('the odd fixture is genuinely misaligned, or it is not testing padding', () => {
    const { expected } = loadFixture('contract-tile-odd');
    const n = expected.pointCount;
    const blockLengths = [6 * n, 6 * n, 2 * n, 2 * n, 1 * n, 4 * n];

    expect(blockLengths.filter((length) => length % 4 !== 0)).toHaveLength(5);
  });

  it('the two fixtures differ in alignment behaviour', () => {
    const aligned = loadFixture('contract-tile').expected.pointCount;
    const odd = loadFixture('contract-tile-odd').expected.pointCount;

    expect((6 * aligned) % 4).toBe(0);
    expect((6 * odd) % 4).not.toBe(0);
  });
});
