import { Vector3 } from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LayerDef } from '../layers/stack.js';
import { FLAG_MODELED } from '../render/typeFlags.js';
import {
  buildSearchIndex,
  FlyTo,
  search,
  viewingDistanceMetres,
  type SearchEntry,
} from './search.js';

const LY = 9460730472580800;
const AU = 149597870700;

const SOLAR: LayerDef = {
  key: 'solar-system',
  url: '/data/solar-system',
  unit: 'AU',
  unitInMetres: AU,
  minRadius: 0,
  maxRadius: 100,
  origin: 'Sun',
};

const MILKY_WAY: LayerDef = {
  key: 'milky-way',
  url: '/data/milky-way',
  unit: 'ly',
  unitInMetres: LY,
  minRadius: 3000,
  maxRadius: 400000,
  origin: 'Sol',
};

const LOCAL_UNIVERSE: LayerDef = {
  key: 'local-universe',
  url: '/data/local-universe',
  unit: 'Mly',
  unitInMetres: LY * 1e6,
  minRadius: 0.3,
  maxRadius: 300,
  origin: 'Milky Way',
};

const STELLAR: LayerDef = {
  key: 'stellar-neighbourhood',
  url: '/data/stellar-neighbourhood',
  unit: 'ly',
  unitInMetres: LY,
  minRadius: 0.01,
  maxRadius: 5000,
  origin: 'Sol',
};

const entry = (name: string, layerKey = 'milky-way', localId = 0): SearchEntry => ({
  name,
  layerKey,
  localId,
  position: [0, 0, 0],
});

describe('search', () => {
  const index = [
    entry('NGC 288', 'milky-way', 1),
    entry('Jupiter', 'solar-system', 5),
    entry('NGC 104 (47 Tuc)', 'milky-way', 0),
    entry('Sagittarius A*', 'milky-way', 2012),
    entry('Sagittarius', 'milky-way', 99),
  ];

  it('matches without regard to case', () => {
    expect(search(index, 'jupiter').map((e) => e.name)).toEqual(['Jupiter']);
    expect(search(index, 'JUPITER').map((e) => e.name)).toEqual(['Jupiter']);
  });

  it('ranks an exact match first', () => {
    expect(search(index, 'Sagittarius')[0]?.name).toBe('Sagittarius');
  });

  it('ranks a prefix match above a substring match', () => {
    const results = search([entry('47 Tuc NGC'), entry('NGC 288')], 'ngc').map((e) => e.name);
    expect(results).toEqual(['NGC 288', '47 Tuc NGC']);
  });

  it('respects the limit', () => {
    expect(search(index, 'ngc', 1)).toHaveLength(1);
    expect(search(index, 'ngc', 0)).toEqual([]);
  });

  it('returns nothing for an empty query', () => {
    expect(search(index, '')).toEqual([]);
    expect(search(index, '   ')).toEqual([]);
  });

  it('returns nothing when nothing matches', () => {
    expect(search(index, 'Betelgeuse')).toEqual([]);
  });
});

const align4 = (n: number): number => n + ((4 - (n % 4)) % 4);

function encodeTile(
  pointCount: number,
  bboxMin: number[],
  bboxMax: number[],
  quantized: Uint16Array,
  typeFlags: Uint8Array,
  localId: Uint32Array,
): ArrayBuffer {
  let offset = 64;
  const starts: number[] = [];
  for (const bytes of [pointCount * 6, pointCount * 6, pointCount * 2, pointCount * 2, pointCount]) {
    starts.push(offset);
    offset = align4(offset + bytes);
  }
  const localIdStart = offset;
  const buffer = new ArrayBuffer(align4(offset + pointCount * 4));
  const view = new DataView(buffer);
  view.setUint32(0, 0x31544d55, true);
  view.setUint32(4, 1, true);
  view.setUint32(8, pointCount, true);
  view.setUint32(12, 0x3f, true);
  for (let i = 0; i < 3; i++) {
    view.setFloat64(16 + i * 8, bboxMin[i]!, true);
    view.setFloat64(40 + i * 8, bboxMax[i]!, true);
  }
  new Uint16Array(buffer, starts[0]!, pointCount * 3).set(quantized);
  new Uint8Array(buffer, starts[4]!, pointCount).set(typeFlags);
  new Uint32Array(buffer, localIdStart, pointCount).set(localId);
  return buffer;
}

interface FakeLayer {
  names: Record<string, string> | null;
  tileset?: unknown;
  tiles?: Record<string, ArrayBuffer>;
}

function stubFetch(layers: Record<string, FakeLayer>): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      for (const [url, layer] of Object.entries(layers)) {
        if (!input.startsWith(`${url}/`)) continue;
        const rest = input.slice(url.length + 1);
        if (rest === 'names.json') {
          return layer.names === null
            ? new Response('<!doctype html>', {
                status: 200,
                headers: { 'content-type': 'text/html' },
              })
            : new Response(JSON.stringify(layer.names), {
                status: 200,
                headers: { 'content-type': 'application/json' },
              });
        }
        if (rest === 'tileset.json') {
          return new Response(JSON.stringify(layer.tileset), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        const tile = layer.tiles?.[rest.replace(/\.bin$/, '')];
        if (tile) {
          return { ok: true, status: 200, arrayBuffer: async () => tile } as unknown as Response;
        }
      }
      return new Response('', { status: 404, headers: { 'content-type': 'text/plain' } });
    }),
  );
}

const node = (path: string, pointCount: number, children: unknown[] = []) => ({
  path,
  boundingBox: { min: [-1, -1, -1], max: [1, 1, 1] },
  geometricError: 1,
  pointCount,
  totalPointCount: pointCount,
  children,
});

const tileset = (layer: string, root: unknown) => ({
  formatVersion: 1,
  layer,
  unit: 'ly',
  unitInMetres: LY,
  frame: 'galactic',
  origin: 'Sol',
  idPrefix: '',
  pointCount: 0,
  root,
});

afterEach(() => vi.unstubAllGlobals());

describe('buildSearchIndex', () => {
  it('indexes only named objects; four million modeled points contribute nothing', async () => {
    const named = 3;
    const modeled = 4_000_000;
    const total = named + modeled;
    const quantized = new Uint16Array(total * 3);
    const typeFlags = new Uint8Array(total);
    const localId = new Uint32Array(total);
    for (let i = 0; i < total; i++) {
      localId[i] = i < named ? i : 2013 + i;
      if (i >= named) typeFlags[i] = FLAG_MODELED;
      quantized[i * 3] = 65535;
    }
    stubFetch({
      '/data/milky-way': {
        names: { '0': 'NGC 104 (47 Tuc)', '1': 'NGC 288', '2': 'Sagittarius A*' },
        tileset: tileset('milky-way', node('r', total)),
        tiles: {
          r: encodeTile(total, [-100, -100, -100], [100, 100, 100], quantized, typeFlags, localId),
        },
      },
    });

    const index = await buildSearchIndex([MILKY_WAY]);

    expect(index).toHaveLength(named);
    expect(index.every((e) => e.name.length > 0)).toBe(true);
    expect(index.every((e) => e.localId < named)).toBe(true);
    expect(index.map((e) => e.name).sort()).toEqual([
      'NGC 104 (47 Tuc)',
      'NGC 288',
      'Sagittarius A*',
    ]);
    expect(index[0]?.position[0]).toBeCloseTo(100, 6);
  });

  it('yields nothing, and fetches no tile, for a layer with no names sidecar', async () => {
    stubFetch({ '/data/stellar-neighbourhood': { names: null } });
    await expect(buildSearchIndex([STELLAR])).resolves.toEqual([]);
    const calls = vi.mocked(fetch).mock.calls.map(([url]) => url);
    expect(calls).toEqual(['/data/stellar-neighbourhood/names.json']);
  });

  it('descends into child tiles to place names the root does not hold', async () => {
    const one = (localId: number, x: number) =>
      encodeTile(
        1,
        [-100, -100, -100],
        [100, 100, 100],
        new Uint16Array([x, 32768, 32768]),
        new Uint8Array([0]),
        new Uint32Array([localId]),
      );
    stubFetch({
      '/data/local-universe': {
        names: { '0': 'PGC 2', '1': 'PGC 4' },
        tileset: tileset('local-universe', node('r', 1, [node('r0', 1)])),
        tiles: { r: one(0, 65535), r0: one(1, 0) },
      },
    });
    const index = await buildSearchIndex([LOCAL_UNIVERSE]);
    expect(index.map((e) => e.name).sort()).toEqual(['PGC 2', 'PGC 4']);
  });

  it('reports each layer as it finishes', async () => {
    stubFetch({
      '/data/solar-system': {
        names: { '0': 'Sun' },
        tileset: tileset('solar-system', node('r', 1)),
        tiles: {
          r: encodeTile(
            1,
            [-1, -1, -1],
            [1, 1, 1],
            new Uint16Array([32768, 32768, 32768]),
            new Uint8Array([0]),
            new Uint32Array([0]),
          ),
        },
      },
      '/data/stellar-neighbourhood': { names: null },
    });
    const seen: string[] = [];
    await buildSearchIndex([SOLAR, STELLAR], (entries) => seen.push(...entries.map((e) => e.name)));
    expect(seen).toEqual(['Sun']);
  });
});

const makeCamera = (x: number, y: number, z: number) => ({
  position: new Vector3(x, y, z),
  lookAt: vi.fn(),
});

describe('viewingDistanceMetres', () => {
  it('is one unit of the target layer, so it scales with the target', () => {
    expect(viewingDistanceMetres(SOLAR)).toBe(AU);
    expect(viewingDistanceMetres(MILKY_WAY)).toBe(LY);
    expect(viewingDistanceMetres(LOCAL_UNIVERSE)).toBe(LY * 1e6);
  });
});

describe('FlyTo', () => {
  const target: SearchEntry = {
    name: 'NGC 5128',
    layerKey: 'local-universe',
    localId: 7,
    position: [12, 0, 0],
  };

  it('arrives one target-layer unit from the target and then stops', () => {
    const fly = new FlyTo();
    const camera = makeCamera(0, 0, 3000);
    fly.start(target, LOCAL_UNIVERSE, camera, MILKY_WAY);
    expect(fly.active).toBe(true);
    fly.update(10, camera, LOCAL_UNIVERSE);

    const metres = camera.position.clone().multiplyScalar(LOCAL_UNIVERSE.unitInMetres);
    const targetMetres = new Vector3(12, 0, 0).multiplyScalar(LOCAL_UNIVERSE.unitInMetres);
    const arrival = metres.distanceTo(targetMetres);
    const wanted = viewingDistanceMetres(LOCAL_UNIVERSE);
    expect(Math.abs(arrival - wanted) / wanted).toBeLessThan(1e-9);
    expect(fly.active).toBe(false);
    expect(camera.lookAt).toHaveBeenCalled();
  });

  it('places the camera identically whichever layer is active mid-flight', () => {
    const fly = new FlyTo();
    const a = makeCamera(0, 0, 3000);
    fly.start(target, LOCAL_UNIVERSE, a, MILKY_WAY);
    fly.update(0.4, a, MILKY_WAY);
    const b = makeCamera(0, 0, 0);
    fly.update(0, b, LOCAL_UNIVERSE);

    const inMetresA = a.position.clone().multiplyScalar(MILKY_WAY.unitInMetres);
    const inMetresB = b.position.clone().multiplyScalar(LOCAL_UNIVERSE.unitInMetres);
    expect(inMetresA.distanceTo(inMetresB) / inMetresA.length()).toBeLessThan(1e-12);
  });

  it('backs off instead of producing NaN when it starts on the target', () => {
    const fly = new FlyTo();
    const camera = makeCamera(12, 0, 0);
    fly.start(target, LOCAL_UNIVERSE, camera, LOCAL_UNIVERSE);
    fly.update(10, camera, LOCAL_UNIVERSE);
    expect(Number.isFinite(camera.position.length())).toBe(true);
    expect(camera.position.distanceTo(new Vector3(12, 0, 0))).toBeCloseTo(1, 6);
  });

  it('does nothing before it is started', () => {
    const fly = new FlyTo();
    const camera = makeCamera(0, 0, 3000);
    fly.update(1, camera, MILKY_WAY);
    expect(camera.position.toArray()).toEqual([0, 0, 3000]);
  });
});
