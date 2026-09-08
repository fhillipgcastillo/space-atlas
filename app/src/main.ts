import { Vector3 } from 'three';
import { Viewer } from './core/viewer.js';
import { Anchor } from './interaction/anchors.js';
import { HoverController } from './interaction/hover.js';
import { PickingPass } from './render/picking.js';
import { createPointMaterial } from './render/pointMaterial.js';
import { TileManager } from './tiles/tileManager.js';
import { fetchTileset, type Tileset } from './tiles/tileset.js';
import { HoverCard } from './ui/hoverCard.js';

const LAYER_URL = '/data/stellar-neighbourhood';
const PARSECS_PER_LIGHT_YEAR = 1 / 3.261563777167433;

declare global {
  interface Window {
    __universeMap?: {
      viewer: Viewer;
      manager: TileManager;
      tileset: Tileset;
      frameTimes: number[];
      picking: PickingPass;
      hover: HoverController;
      identifiersReady: Promise<void>;
    };
  }
}

async function fetchIdentifiers(): Promise<BigUint64Array> {
  const response = await fetch(`${LAYER_URL}/ids.bin`);
  if (!response.ok) throw new Error(`ids: HTTP ${response.status}`);
  return new BigUint64Array(await response.arrayBuffer());
}

// The identifier table is tens of megabytes and only hover needs it, so the
// starfield must never wait on it: until it lands, hover says "Star".
let identifiers: BigUint64Array | undefined;

async function boot(): Promise<void> {
  const viewer = new Viewer(document.body);
  const tileset = await fetchTileset(LAYER_URL);
  const material = createPointMaterial(PARSECS_PER_LIGHT_YEAR);
  const manager = new TileManager(LAYER_URL, tileset, material);

  viewer.add(manager.group);
  // Far enough out that the root subsample reads as a field.
  viewer.camera.position.set(0, 0, 3000);

  const identifiersReady = fetchIdentifiers().then(
    (ids) => {
      identifiers = ids;
    },
    (error: unknown) => console.warn('identifier table unavailable', error),
  );

  const picking = new PickingPass(viewer.renderer, viewer.scene, viewer.camera);
  const card = new HoverCard(document.body);
  const hover = new HoverController(
    picking,
    card,
    {
      unit: tileset.unit,
      tileForSlot: (slot) => manager.tilesBySlot.get(slot),
      catalogId: (tile, index) => {
        const local = tile.localId[index];
        return local === undefined ? undefined : identifiers?.[local];
      },
    },
    viewer.renderer.domElement,
  );

  // Earth sits at the origin of this layer; the label is permanent so the
  // viewer always knows where they are.
  const earth = new Anchor('Earth', new Vector3(0, 0, 0), document.body);

  const frameTimes: number[] = [];
  viewer.onFrame((dt) => {
    frameTimes.push(dt * 1000);
    if (frameTimes.length > 600) frameTimes.shift();
    manager.update({
      position: viewer.camera.position,
      screenHeight: viewer.renderer.domElement.height,
      fovRadians: (viewer.camera.fov * Math.PI) / 180,
    });
    earth.update(viewer.camera, window.innerWidth, window.innerHeight);
  });

  viewer.start();
  window.__universeMap = {
    viewer,
    manager,
    tileset,
    frameTimes,
    picking,
    hover,
    identifiersReady,
  };
  console.info(`loaded ${tileset.layer}: ${tileset.pointCount} points total`);
}

void boot();
