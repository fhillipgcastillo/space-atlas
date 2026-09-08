import { describe, expect, it, vi } from 'vitest';
import type { RawShaderMaterial } from 'three';
import type { DecodedTile } from '../tiles/format.js';
import { LayerRenderer } from './layerRenderer.js';
import type { LayerDef } from './stack.js';

const LY_IN_METRES = 9460730472580800;

const def: LayerDef = {
  key: 'stellar',
  url: '/data/stellar',
  unit: 'ly',
  unitInMetres: LY_IN_METRES,
  minRadius: 0.01,
  maxRadius: 5000,
  origin: 'Sol',
};

const tilesetJson = {
  formatVersion: 1,
  layer: 'stellar',
  unit: 'ly',
  unitInMetres: LY_IN_METRES,
  frame: 'galactic',
  origin: 'Sol',
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

const tile: DecodedTile = {
  pointCount: 1,
  bboxMin: new Float64Array([0, 0, 0]),
  bboxMax: new Float64Array([1, 1, 1]),
  positionQuantized: new Uint16Array([1, 2, 3]),
  velocity: new Uint16Array([0, 0, 0]),
  colorIndex: new Uint16Array([100]),
  absMag: new Uint16Array([0]),
  typeFlags: new Uint8Array([1]),
  localId: new Uint32Array([0]),
};

async function makeRenderer(): Promise<LayerRenderer> {
  vi.stubGlobal('window', { devicePixelRatio: 1 });
  vi.stubGlobal('fetch', async () => ({ ok: true, json: async () => tilesetJson }));
  return LayerRenderer.create(def, 0.3066);
}

/** The loader callback a completed tile fetch invokes; it clones the material per tile. */
const deliver = (renderer: LayerRenderer, path: string): RawShaderMaterial => {
  const manager = renderer.manager as unknown as {
    loader: { onLoaded: (path: string, tile: DecodedTile) => void };
  };
  manager.loader.onLoaded(path, tile);
  return renderer.manager.meshes.get(path)!.material as RawShaderMaterial;
};

describe('LayerRenderer opacity', () => {
  it('gives a tile that streams in after an opacity change the current opacity', async () => {
    const renderer = await makeRenderer();

    renderer.setOpacity(0.25);
    // If this reads 1, fading a layer out leaves a trail of full-brightness tiles.
    expect(deliver(renderer, 'r0').uniforms['uLayerOpacity']!.value).toBe(0.25);

    renderer.setOpacity(1);
    expect(deliver(renderer, 'r1').uniforms['uLayerOpacity']!.value).toBe(1);
  });

  it('raises an already-streamed tile back to full opacity', async () => {
    const renderer = await makeRenderer();
    renderer.setOpacity(0.25);
    const material = deliver(renderer, 'r0');

    renderer.setOpacity(1);
    // If this stays 0.25, fading back in leaves the tiles already on screen dim.
    expect(material.uniforms['uLayerOpacity']!.value).toBe(1);
  });

  it('stops streaming at zero opacity', async () => {
    const renderer = await makeRenderer();
    const update = vi.spyOn(renderer.manager, 'update').mockImplementation(() => {});
    const view = { position: { x: 0, y: 0, z: 1 }, screenHeight: 800, fovRadians: 1 };

    renderer.update(view);
    renderer.setOpacity(0);
    renderer.update(view);

    // A second call means an invisible layer is still competing for the eight in-flight slots.
    expect(update).toHaveBeenCalledTimes(1);
  });
});
