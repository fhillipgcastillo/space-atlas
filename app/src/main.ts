import { Viewer } from './core/viewer.js';
import { createPointMaterial } from './render/pointMaterial.js';
import { TileManager } from './tiles/tileManager.js';
import { fetchTileset, type Tileset } from './tiles/tileset.js';

const LAYER_URL = '/data/stellar-neighbourhood';
const PARSECS_PER_LIGHT_YEAR = 1 / 3.261563777167433;

declare global {
  interface Window {
    __universeMap?: {
      viewer: Viewer;
      manager: TileManager;
      tileset: Tileset;
      frameTimes: number[];
    };
  }
}

async function boot(): Promise<void> {
  const viewer = new Viewer(document.body);
  const tileset = await fetchTileset(LAYER_URL);
  const material = createPointMaterial(PARSECS_PER_LIGHT_YEAR);
  const manager = new TileManager(LAYER_URL, tileset, material);

  viewer.add(manager.group);
  // Far enough out that the root subsample reads as a field.
  viewer.camera.position.set(0, 0, 3000);

  const frameTimes: number[] = [];
  viewer.onFrame((dt) => {
    frameTimes.push(dt * 1000);
    if (frameTimes.length > 600) frameTimes.shift();
    manager.update({
      position: viewer.camera.position,
      screenHeight: viewer.renderer.domElement.height,
      fovRadians: (viewer.camera.fov * Math.PI) / 180,
    });
  });

  viewer.start();
  window.__universeMap = { viewer, manager, tileset, frameTimes };
  console.info(`loaded ${tileset.layer}: ${tileset.pointCount} points total`);
}

void boot();
