import { describe, expect, it, vi } from 'vitest';
import { SlotPool } from '../render/pickIds.js';
import { createPointMaterial } from '../render/pointMaterial.js';
import type { DecodedTile } from './format.js';
import {
  DEFAULT_OPTIONS,
  maxNodesForBudget,
  TileManager,
  type TileManagerOptions,
} from './tileManager.js';
import type { Tileset, TileNode } from './tileset.js';
import { selectNodes, selectNodesWithFlux, type ViewState } from './traversal.js';

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

describe('flux weighting', () => {
  it('a coarse selection represents the same total light as a fine one', () => {
    const child: TileNode = {
      path: 'r0',
      boundingBox: { min: [-1, -1, -1], max: [1, 1, 1] },
      geometricError: 1e-6,
      pointCount: 800,
      totalPointCount: 800,
      children: [],
    };
    const root: TileNode = {
      path: 'r',
      boundingBox: { min: [-1, -1, -1], max: [1, 1, 1] },
      geometricError: 1e9,
      pointCount: 100,
      totalPointCount: 900,
      children: [child],
    };

    const near: ViewState = { position: { x: 0, y: 0, z: 0 }, screenHeight: 1080, fovRadians: 1 };
    const far: ViewState = { position: { x: 1e12, y: 0, z: 0 }, screenHeight: 1080, fovRadians: 1 };

    const total = (v: ViewState): number =>
      selectNodesWithFlux(root, v, 8, 100).reduce(
        (sum, s) => sum + s.node.pointCount * s.fluxWeight,
        0,
      );

    expect(total(near)).toBeCloseTo(900);
    expect(total(far)).toBeCloseTo(900);
  });
});

const slotTileset: Tileset = {
  formatVersion: 1,
  layer: 'test',
  unit: 'ly',
  unitInMetres: 9460730472580800,
  frame: 'galactic',
  origin: 'Sol',
  idPrefix: '',
  pointCount: 1,
  root: {
    path: 'r',
    boundingBox: { min: [0, 0, 0], max: [1, 1, 1] },
    geometricError: 1,
    pointCount: 1,
    totalPointCount: 1,
    children: [],
  },
};

const oneTile = (points: number): DecodedTile => ({
  pointCount: points,
  bboxMin: new Float64Array([0, 0, 0]),
  bboxMax: new Float64Array([1, 1, 1]),
  positionQuantized: new Uint16Array(points * 3),
  velocity: new Uint16Array(points * 3),
  colorIndex: new Uint16Array(points),
  absMag: new Uint16Array(points),
  typeFlags: new Uint8Array(points),
  localId: new Uint32Array(points),
});

const makeManager = (options?: Partial<TileManagerOptions>): TileManager => {
  vi.stubGlobal('window', { devicePixelRatio: 1 });
  return new TileManager('/data/test', slotTileset, createPointMaterial(1), {
    ...DEFAULT_OPTIONS,
    ...options,
  });
};

/** The callback a finished fetch invokes, which is where a slot is assigned. */
const deliver = (manager: TileManager, path: string, points = 1): void => {
  (
    manager as unknown as { loader: { onLoaded: (path: string, tile: DecodedTile) => void } }
  ).loader.onLoaded(path, oneTile(points));
};

const slotOf = (manager: TileManager, path: string): number =>
  manager.meshes.get(path)!.userData['tileSlot'] as number;

describe('pick slots', () => {
  it('never gives two managers the same slot', () => {
    const stellar = makeManager();
    const milkyWay = makeManager();
    try {
      deliver(stellar, 'r');
      deliver(milkyWay, 'r');
      deliver(stellar, 'r0');
      deliver(milkyWay, 'r0');

      const slots = [
        slotOf(stellar, 'r'),
        slotOf(stellar, 'r0'),
        slotOf(milkyWay, 'r'),
        slotOf(milkyWay, 'r0'),
      ];
      // The picking pass draws every visible layer into one target, so a slot
      // shared by two managers resolves a hit against the wrong object.
      expect(new Set(slots).size).toBe(slots.length);
    } finally {
      stellar.dispose();
      milkyWay.dispose();
    }
  });

  it('keeps a path on the slot it already holds', () => {
    const manager = makeManager();
    try {
      deliver(manager, 'r');
      const first = slotOf(manager, 'r');
      deliver(manager, 'r');
      expect([...manager.tilesBySlot.keys()]).toEqual([first]);
    } finally {
      manager.dispose();
    }
  });

  it('returns evicted and disposed slots to the pool', () => {
    const pool = new SlotPool();
    const budget = 8 * 41;
    const manager = new TileManager(
      '/data/test',
      slotTileset,
      createPointMaterial(1),
      { ...DEFAULT_OPTIONS, gpuByteBudget: budget },
      pool,
    );
    vi.stubGlobal('window', { devicePixelRatio: 1 });

    for (let i = 0; i < 40; i++) deliver(manager, `r${i}`, 8);
    // The cache holds one tile at this budget, so every earlier slot must have
    // come back or a long session runs out.
    expect(pool.inUse).toBe(1);
    expect(manager.tilesBySlot.size).toBe(1);

    manager.dispose();
    expect(pool.inUse).toBe(0);
  });

  it('reuses a released slot rather than climbing to the ceiling', () => {
    const pool = new SlotPool();
    const first = pool.acquire();
    pool.release(first);
    expect(pool.acquire()).toBe(first);
    expect(pool.inUse).toBe(1);
  });
});
