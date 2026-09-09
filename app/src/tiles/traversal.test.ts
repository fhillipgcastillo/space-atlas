import { describe, expect, it } from 'vitest';
import type { TileNode } from './tileset.js';
import {
  distanceToBox,
  screenSpaceError,
  selectNodes,
  selectNodesWithFlux,
} from './traversal.js';

const node = (
  path: string,
  min: number[],
  max: number[],
  error: number,
  children: TileNode[] = [],
): TileNode => ({
  path,
  boundingBox: { min, max },
  geometricError: error,
  pointCount: 100,
  totalPointCount: 100 * (1 + children.length),
  children,
});

const view = { position: { x: 0, y: 0, z: 0 }, screenHeight: 1080, fovRadians: Math.PI / 3 };

describe('distanceToBox', () => {
  it('is zero inside the box', () => {
    expect(distanceToBox({ x: 0, y: 0, z: 0 }, [-1, -1, -1], [1, 1, 1])).toBe(0);
  });

  it('measures the perpendicular distance to a face', () => {
    expect(distanceToBox({ x: 5, y: 0, z: 0 }, [-1, -1, -1], [1, 1, 1])).toBeCloseTo(4);
  });

  it('measures the diagonal distance to a corner', () => {
    expect(distanceToBox({ x: 4, y: 5, z: 1 }, [-1, -1, -1], [1, 1, 1])).toBeCloseTo(5);
  });
});

describe('screenSpaceError', () => {
  it('falls as distance grows', () => {
    const near = screenSpaceError(10, 100, 1080, Math.PI / 3);
    const far = screenSpaceError(10, 1000, 1080, Math.PI / 3);
    expect(far).toBeLessThan(near);
  });

  it('is unbounded at zero distance so a node you are inside always refines', () => {
    expect(screenSpaceError(10, 0, 1080, Math.PI / 3)).toBe(Infinity);
  });

  it('grows with screen height', () => {
    expect(screenSpaceError(10, 100, 2160, Math.PI / 3)).toBeGreaterThan(
      screenSpaceError(10, 100, 1080, Math.PI / 3),
    );
  });

  it('is zero for a zero geometric error, even at zero distance', () => {
    expect(screenSpaceError(0, 100, 1080, Math.PI / 3)).toBe(0);
    expect(screenSpaceError(0, 0, 1080, Math.PI / 3)).toBe(0);
  });

  it('never returns NaN for a non-finite geometric error or distance', () => {
    expect(screenSpaceError(Number.NaN, 100, 1080, Math.PI / 3)).toBe(0);
    expect(screenSpaceError(10, Number.NaN, 1080, Math.PI / 3)).toBe(0);
  });
});

describe('selectNodes', () => {
  it('returns the root alone when its error is below threshold', () => {
    const root = node('r', [1e6, 1e6, 1e6], [1e6 + 1, 1e6 + 1, 1e6 + 1], 0.001, [
      node('r0', [1e6, 1e6, 1e6], [1e6 + 1, 1e6 + 1, 1e6 + 1], 0.0005),
    ]);
    expect(selectNodes(root, view, 16, 1000).map((n) => n.path)).toEqual(['r']);
  });

  it('includes the parent as well as its children, because refinement is additive', () => {
    const child = node('r0', [-1, -1, -1], [1, 1, 1], 0.0001);
    const root = node('r', [-1, -1, -1], [1, 1, 1], 1000, [child]);
    const paths = selectNodes(root, view, 16, 1000).map((n) => n.path);
    expect(paths).toContain('r');
    expect(paths).toContain('r0');
  });

  it('respects the node budget', () => {
    const children = Array.from({ length: 8 }, (_, i) =>
      node(`r${i}`, [-1, -1, -1], [1, 1, 1], 1000, [
        node(`r${i}0`, [-1, -1, -1], [1, 1, 1], 1000),
      ]),
    );
    const root = node('r', [-1, -1, -1], [1, 1, 1], 1000, children);
    expect(selectNodes(root, view, 1, 5)).toHaveLength(5);
  });

  it('prefers nearer nodes when the budget binds', () => {
    const near = node('rNear', [-1, -1, -1], [1, 1, 1], 1000);
    const far = node('rFar', [5000, 5000, 5000], [5001, 5001, 5001], 1000);
    const root = node('r', [-1, -1, -1], [5001, 5001, 5001], 1e9, [far, near]);
    const paths = selectNodes(root, view, 1, 2).map((n) => n.path);
    expect(paths).toContain('rNear');
    expect(paths).not.toContain('rFar');
  });

  it('terminates on a degenerate root with a zero-extent box and zero error', () => {
    const root = node('r', [0, 0, 0], [0, 0, 0], 0);
    expect(selectNodes(root, view, 16, 1000).map((n) => n.path)).toEqual(['r']);
  });

  it('does not let a degenerate sibling stall refinement of the rest', () => {
    const degenerate = node('rDeg', [0, 0, 0], [0, 0, 0], 0);
    const grandchild = node('rGood0', [-1, -1, -1], [1, 1, 1], 0.0001);
    const good = node('rGood', [-1, -1, -1], [1, 1, 1], 1000, [grandchild]);
    const root = node('r', [-1, -1, -1], [1, 1, 1], 1000, [degenerate, good]);

    const paths = selectNodes(root, view, 16, 1000).map((n) => n.path);

    expect(paths).toEqual(['r', 'rGood', 'rGood0', 'rDeg']);
  });
});

const withCounts = (
  path: string,
  min: number[],
  max: number[],
  error: number,
  pointCount: number,
  totalPointCount: number,
  children: TileNode[] = [],
): TileNode => ({
  path,
  boundingBox: { min, max },
  geometricError: error,
  pointCount,
  totalPointCount,
  children,
});

describe('selectNodesWithFlux', () => {
  it('weighs a lone leaf by how many points it stands in for', () => {
    const leaf = withCounts('r', [-1, -1, -1], [1, 1, 1], 0.0001, 1000, 8000);
    const [selected] = selectNodesWithFlux(leaf, view, 16, 100);
    expect(selected!.fluxWeight).toBeCloseTo(8);
  });

  it('weighs a fully refined parent as 1', () => {
    const a = withCounts('r0', [-1, -1, -1], [1, 1, 1], 1e6, 400, 400);
    const b = withCounts('r1', [-1, -1, -1], [1, 1, 1], 1e6, 400, 400);
    const root = withCounts('r', [-1, -1, -1], [1, 1, 1], 1e9, 100, 900, [a, b]);

    const selected = selectNodesWithFlux(root, view, 1, 100);
    const parent = selected.find((s) => s.node.path === 'r')!;
    expect(parent.fluxWeight).toBeCloseTo(1);
  });

  it('counts only the children that were left out', () => {
    const near = withCounts('r0', [-1, -1, -1], [1, 1, 1], 1e6, 100, 100);
    const far = withCounts('r1', [1e9, 1e9, 1e9], [1e9 + 1, 1e9 + 1, 1e9 + 1], 1e-9, 700, 700);
    const root = withCounts(
      'r',
      [-1, -1, -1],
      [1e9 + 1, 1e9 + 1, 1e9 + 1],
      1e9,
      100,
      900,
      [near, far],
    );

    // A budget of 2 is what leaves the far child out: selection is additive and
    // pops unconditionally, so nothing is skipped while the budget has room.
    const selected = selectNodesWithFlux(root, view, 1, 2);
    const paths = selected.map((s) => s.node.path);
    expect(paths).toContain('r');
    expect(paths).not.toContain('r1');

    const parent = selected.find((s) => s.node.path === 'r')!;
    expect(parent.fluxWeight).toBeCloseTo(8);
  });

  it('never returns a weight below 1', () => {
    const leaf = withCounts('r', [-1, -1, -1], [1, 1, 1], 0.0001, 500, 500);
    expect(selectNodesWithFlux(leaf, view, 16, 100)[0]!.fluxWeight).toBeGreaterThanOrEqual(1);
  });

  it('survives a node that draws no points', () => {
    const leaf = withCounts('r', [-1, -1, -1], [1, 1, 1], 0.0001, 0, 0);
    const [selected] = selectNodesWithFlux(leaf, view, 16, 100);
    expect(Number.isFinite(selected!.fluxWeight)).toBe(true);
  });

  it('conserves total represented points across the selection', () => {
    const a = withCounts('r0', [-1, -1, -1], [1, 1, 1], 1e6, 400, 400);
    const b = withCounts('r1', [2e9, 2e9, 2e9], [2e9 + 1, 2e9 + 1, 2e9 + 1], 1e-9, 400, 400);
    const root = withCounts('r', [-1, -1, -1], [2e9 + 1, 2e9 + 1, 2e9 + 1], 1e9, 100, 900, [a, b]);

    const selected = selectNodesWithFlux(root, view, 1, 100);
    const represented = selected.reduce((sum, s) => sum + s.node.pointCount * s.fluxWeight, 0);
    expect(represented).toBeCloseTo(900);
  });

  it('agrees with selectNodes on which nodes are chosen', () => {
    const child = withCounts('r0', [-1, -1, -1], [1, 1, 1], 0.0001, 10, 10);
    const root = withCounts('r', [-1, -1, -1], [1, 1, 1], 1000, 10, 20, [child]);

    expect(selectNodesWithFlux(root, view, 16, 100).map((s) => s.node.path)).toEqual(
      selectNodes(root, view, 16, 100).map((n) => n.path),
    );
  });
});
