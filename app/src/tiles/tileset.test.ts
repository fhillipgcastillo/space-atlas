import { describe, expect, it } from 'vitest';
import { parseTileset } from './tileset.js';

const valid = {
  formatVersion: 1,
  layer: 'stellar-neighbourhood',
  unit: 'ly',
  unitInMetres: 9460730472580800,
  frame: 'galactic',
  origin: 'Sol',
  pointCount: 10,
  root: {
    path: 'r',
    boundingBox: { min: [0, 0, 0], max: [1, 1, 1] },
    geometricError: 2,
    pointCount: 10,
    totalPointCount: 10,
    children: [],
  },
};

describe('parseTileset', () => {
  it('accepts a well-formed tileset', () => {
    expect(parseTileset(valid).layer).toBe('stellar-neighbourhood');
  });

  it('rejects an unsupported format version', () => {
    expect(() => parseTileset({ ...valid, formatVersion: 2 })).toThrow(/version/i);
  });

  it('rejects a tileset with no root', () => {
    const withoutRoot: Record<string, unknown> = { ...valid };
    delete withoutRoot['root'];
    expect(() => parseTileset(withoutRoot)).toThrow(/root/i);
  });

  it('rejects a node with a malformed bounding box', () => {
    const broken = {
      ...valid,
      root: { ...valid.root, boundingBox: { min: [0, 0], max: [1, 1, 1] } },
    };
    expect(() => parseTileset(broken)).toThrow(/bounding box/i);
  });

  it('parses nested children', () => {
    const nested = {
      ...valid,
      root: { ...valid.root, children: [{ ...valid.root, path: 'r0' }] },
    };
    expect(parseTileset(nested).root.children[0]!.path).toBe('r0');
  });
});
