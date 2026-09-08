import { Viewer } from './core/viewer.js';
import { createPointMaterial } from './render/pointMaterial.js';
import { createTileMesh } from './render/tileMesh.js';
import { fetchTile, fetchTileset } from './tiles/tileset.js';

const LAYER_URL = '/data/stellar-neighbourhood';
const PARSECS_PER_LIGHT_YEAR = 1 / 3.261563777167433;

async function boot(): Promise<void> {
  const viewer = new Viewer(document.body);
  viewer.start();

  const tileset = await fetchTileset(LAYER_URL);
  const material = createPointMaterial(PARSECS_PER_LIGHT_YEAR);
  const root = await fetchTile(LAYER_URL, tileset.root.path);
  viewer.add(createTileMesh(root, material));

  // Far enough out that the root subsample reads as a field.
  viewer.camera.position.set(0, 0, 3000);
  console.info(`loaded ${tileset.layer}: ${tileset.pointCount} points total`);
}

void boot();
