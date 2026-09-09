import { describe, expect, it } from 'vitest';
import type { TileNode } from '../tiles/tileset.js';
import { nodeWithinCutoffs, selectNodes, type ViewState } from '../tiles/traversal.js';
import {
  cutoffOf,
  formatCutoff,
  normaliseCutoff,
  UNLIMITED,
  withCutoff,
  NO_CUTOFFS,
} from './rangeControls.js';

const node = (path: string, min: number[], max: number[], children: TileNode[] = []): TileNode => ({
  path,
  boundingBox: { min, max },
  geometricError: 100,
  pointCount: 100,
  totalPointCount: 100 * (1 + children.length),
  children,
});

const view = (position: { x: number; y: number; z: number }, cutoffs: Partial<ViewState> = {}) => ({
  position,
  screenHeight: 1080,
  fovRadians: Math.PI / 3,
  ...cutoffs,
});

const near = node('near', [-10, -10, -10], [10, 10, 10]);
const straddling = node('straddling', [90, -10, -10], [110, 10, 10]);
const beyond = node('beyond', [500, -10, -10], [600, 10, 10]);

describe('earth-mode culling', () => {
  it('keeps a node straddling the shell', () => {
    expect(nodeWithinCutoffs(straddling, view({ x: 0, y: 0, z: 0 }, { maxOriginDistance: 100 }))).toBe(
      true,
    );
  });

  it('culls a node entirely outside the shell', () => {
    expect(nodeWithinCutoffs(beyond, view({ x: 0, y: 0, z: 0 }, { maxOriginDistance: 100 }))).toBe(
      false,
    );
  });

  it('does not change the visible set when the camera moves', () => {
    const positions = [
      { x: 0, y: 0, z: 0 },
      { x: 550, y: 0, z: 0 },
      { x: -9000, y: 4000, z: 250 },
    ];
    const kept = positions.map((position) =>
      [near, straddling, beyond]
        .filter((n) => nodeWithinCutoffs(n, view(position, { maxOriginDistance: 100 })))
        .map((n) => n.path),
    );
    expect(kept[0]).toEqual(['near', 'straddling']);
    expect(kept[1]).toEqual(kept[0]);
    expect(kept[2]).toEqual(kept[0]);
  });
});

describe('camera-mode culling', () => {
  it('keeps a node straddling the draw distance', () => {
    expect(nodeWithinCutoffs(straddling, view({ x: 0, y: 0, z: 0 }, { maxCameraDistance: 100 }))).toBe(
      true,
    );
  });

  it('culls a node entirely beyond the draw distance', () => {
    expect(nodeWithinCutoffs(beyond, view({ x: 0, y: 0, z: 0 }, { maxCameraDistance: 100 }))).toBe(
      false,
    );
  });

  it('changes the visible set as the camera moves', () => {
    const atOrigin = nodeWithinCutoffs(beyond, view({ x: 0, y: 0, z: 0 }, { maxCameraDistance: 100 }));
    const alongside = nodeWithinCutoffs(
      beyond,
      view({ x: 550, y: 0, z: 0 }, { maxCameraDistance: 100 }),
    );
    expect(atOrigin).toBe(false);
    expect(alongside).toBe(true);
  });
});

describe('both modes active', () => {
  it('draws only what satisfies both', () => {
    const outer = node('outer', [200, -10, -10], [220, 10, 10]);
    const both = view({ x: 150, y: 0, z: 0 }, { maxOriginDistance: 100, maxCameraDistance: 100 });
    expect(nodeWithinCutoffs(straddling, both)).toBe(true);
    // Inside the Earth shell, too far from the camera.
    expect(nodeWithinCutoffs(near, both)).toBe(false);
    // Inside the draw distance, outside the Earth shell.
    expect(nodeWithinCutoffs(outer, both)).toBe(false);
    expect(nodeWithinCutoffs(beyond, both)).toBe(false);
  });

  it('is unlimited when neither is set', () => {
    const none = view({ x: 0, y: 0, z: 0 });
    for (const n of [near, straddling, beyond]) expect(nodeWithinCutoffs(n, none)).toBe(true);
  });
});

describe('traversal', () => {
  const root = node('r', [-600, -600, -600], [600, 600, 600], [near, straddling, beyond]);

  it('never selects a culled node, so it is never fetched', () => {
    const paths = selectNodes(
      root,
      view({ x: 0, y: 0, z: 0 }, { maxOriginDistance: 100 }),
      1,
      64,
    ).map((n) => n.path);
    expect(paths).toContain('near');
    expect(paths).toContain('straddling');
    expect(paths).not.toContain('beyond');
  });

  it('selects nothing when the root itself lies beyond the cutoff', () => {
    const far = node('far-root', [1000, 1000, 1000], [1100, 1100, 1100]);
    expect(selectNodes(far, view({ x: 0, y: 0, z: 0 }, { maxOriginDistance: 100 }), 1, 64)).toEqual(
      [],
    );
  });

  it('selects everything when no cutoff is set', () => {
    expect(selectNodes(root, view({ x: 0, y: 0, z: 0 }), 1, 64)).toHaveLength(4);
  });
});

describe('cutoff values', () => {
  it('treats zero, negative and unparseable entries as unlimited', () => {
    expect(normaliseCutoff(0)).toBe(UNLIMITED);
    expect(normaliseCutoff(-5)).toBe(UNLIMITED);
    expect(normaliseCutoff(Number.NaN)).toBe(UNLIMITED);
    expect(normaliseCutoff(500)).toBe(500);
  });

  it('edits one mode without disturbing the other', () => {
    const earth = withCutoff(NO_CUTOFFS, 'earth', 500);
    expect(earth).toEqual({ fromEarth: 500, fromCamera: UNLIMITED });
    const both = withCutoff(earth, 'camera', 50);
    expect(both).toEqual({ fromEarth: 500, fromCamera: 50 });
    expect(cutoffOf(both, 'earth')).toBe(500);
    expect(cutoffOf(both, 'camera')).toBe(50);
  });

  it('shows the active layer unit alongside the number', () => {
    expect(formatCutoff(500, 'ly')).toBe('500 ly');
    expect(formatCutoff(2500, 'Mly')).toBe('2,500 Mly');
    expect(formatCutoff(UNLIMITED, 'ly')).toBe('unlimited');
  });
});
