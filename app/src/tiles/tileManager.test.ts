import { describe, expect, it } from 'vitest';
import { DEFAULT_OPTIONS, maxNodesForBudget } from './tileManager.js';
import type { TileNode } from './tileset.js';
import { selectNodes, type ViewState } from './traversal.js';

describe('maxNodesForBudget', () => {
  it('never lets a full selection exceed the byte budget', () => {
    const budget = 512 * 1024 * 1024;
    const nodes = maxNodesForBudget(budget, 41);
    expect(nodes * 65536 * 41).toBeLessThanOrEqual(budget);
  });

  it('shrinks as the per-point cost grows', () => {
    expect(maxNodesForBudget(512 * 1024 * 1024, 82)).toBeLessThan(
      maxNodesForBudget(512 * 1024 * 1024, 41),
    );
  });

  it('always allows at least one node', () => {
    expect(maxNodesForBudget(1, 41)).toBe(1);
  });

  it('keeps the shipped defaults self-consistent', () => {
    expect(DEFAULT_OPTIONS.maxVisibleNodes * 65536 * 41).toBeLessThanOrEqual(
      DEFAULT_OPTIONS.gpuByteBudget,
    );
  });
});

// Mirrors the shipped stellar layer: root half-extent 5000 ly, geometric error
// 425.46, octree halving both per level, six levels.
function syntheticTree(
  path: string,
  centre: number[],
  half: number,
  error: number,
  depth: number,
): TileNode {
  const children: TileNode[] = [];
  if (depth > 0) {
    for (let i = 0; i < 8; i++) {
      const childCentre = centre.map((c, a) => c + (((i >> a) & 1 ? 1 : -1) * half) / 2);
      children.push(syntheticTree(`${path}${i}`, childCentre, half / 2, error / 2, depth - 1));
    }
  }
  return {
    path,
    boundingBox: {
      min: centre.map((c) => c - half),
      max: centre.map((c) => c + half),
    },
    geometricError: error,
    pointCount: 65536,
    totalPointCount: 65536,
    children,
  };
}

describe('the shipped screen-space error threshold', () => {
  const root = syntheticTree('r', [0, 0, 0], 5000, 425.46, 5);
  const view = (z: number): ViewState => ({
    position: { x: 0, y: 0, z },
    screenHeight: 720,
    fovRadians: (60 * Math.PI) / 180,
  });
  const select = (z: number): number =>
    selectNodes(
      root,
      view(z),
      DEFAULT_OPTIONS.screenSpaceErrorThreshold,
      DEFAULT_OPTIONS.maxVisibleNodes,
    ).length;

  it('keeps refining once the camera leaves the root bounding box', () => {
    // The camera crosses the box wall between these two, which is where the
    // old threshold dropped the layer to its root subsample in one step.
    expect(select(5000)).toBeGreaterThan(1);
    expect(select(8000)).toBeGreaterThan(1);
  });

  it('never coarsens by more than one octree level per doubling of distance', () => {
    let previous = select(5000);
    for (let z = 8000; z <= 512_000; z *= 2) {
      const current = select(z);
      expect(current).toBeLessThanOrEqual(previous);
      // Selection is additive, so shedding one octree level divides the count
      // by at most 9; more than that means a whole level was skipped.
      expect(previous / current).toBeLessThanOrEqual(9);
      previous = current;
    }
  });
});
