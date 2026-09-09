import { Vector3 } from 'three';
import { Viewer } from './core/viewer.js';
import { Anchor } from './interaction/anchors.js';
import { HoverController } from './interaction/hover.js';
import { buildSearchIndex, FlyTo, type SearchEntry } from './interaction/search.js';
import { LayerRenderer, opacityForBlend } from './layers/layerRenderer.js';
import { LAYERS } from './layers/registry.js';
import { loadIdentifiers, loadNames } from './layers/sidecars.js';
import {
  rescalePosition,
  selectLayers,
  type LayerDef,
  type LayerSelection,
} from './layers/stack.js';
import { PickingPass } from './render/picking.js';
import type { TileManager } from './tiles/tileManager.js';
import type { Tileset } from './tiles/tileset.js';
import { HoverCard } from './ui/hoverCard.js';
import { ModeledNotice } from './ui/modeledNotice.js';
import { ScaleHud } from './ui/scaleHud.js';
import { SearchBox } from './ui/searchBox.js';

const METRES_PER_PARSEC = 3.0856775814913673e16;

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
      layers: LayerRenderer[];
      selection: () => LayerSelection;
      activeLayer: () => LayerDef;
      modeledNotice: ModeledNotice;
    };
  }
}

async function boot(): Promise<void> {
  const viewer = new Viewer(document.body);

  const renderers = await Promise.all(
    LAYERS.map((def) => LayerRenderer.create(def, def.unitInMetres / METRES_PER_PARSEC)),
  );
  for (const renderer of renderers) viewer.add(renderer.group);

  // The identifier tables are tens of megabytes and only hover needs them, so
  // the field must never wait on them.
  const identifiers = new Map<string, BigUint64Array>();
  const names = new Map<string, Map<number, string>>();
  const identifiersReady = Promise.all(
    LAYERS.map(async (def) => {
      names.set(def.key, await loadNames(def.url));
      const ids = await loadIdentifiers(def.url).catch((error: unknown) => {
        console.warn(`identifier table unavailable for ${def.key}`, error);
        return undefined;
      });
      if (ids) identifiers.set(def.key, ids);
    }),
  ).then(() => undefined);

  let primary = renderers[1]!;
  let active = primary.def;
  viewer.camera.position.set(0, 0, 3000);

  const picking = new PickingPass(viewer.renderer, viewer.scene, viewer.camera);
  const card = new HoverCard(document.body);
  const hover = new HoverController(
    picking,
    card,
    {
      get unit() {
        return primary.def.unit;
      },
      get origin() {
        return primary.tileset.origin;
      },
      tileForSlot: (slot) => primary.manager.tilesBySlot.get(slot),
      identify: (tile, index) => {
        const local = tile.localId[index];
        if (local === undefined) return undefined;
        const key = primary.def.key;
        const named = names.get(key)?.get(local);
        if (named !== undefined) return named;
        const id = identifiers.get(key)?.[local];
        if (id === undefined) return undefined;
        const prefix = primary.tileset.idPrefix;
        return prefix ? `${prefix} ${id}` : String(id);
      },
    },
    viewer.renderer.domElement,
  );

  const earth = new Anchor('Earth', new Vector3(0, 0, 0), document.body);
  const modeledNotice = new ModeledNotice(document.body);
  const scaleHud = new ScaleHud(document.body);
  const modeledRenderers = renderers.filter((r) => r.def.key === 'milky-way');

  let selection = selectLayers(0, LAYERS);
  const frameTimes: number[] = [];

  viewer.onFrame((dt) => {
    frameTimes.push(dt * 1000);
    if (frameTimes.length > 600) frameTimes.shift();

    const distanceMetres = viewer.camera.position.length() * active.unitInMetres;
    selection = selectLayers(distanceMetres, LAYERS);

    if (selection.primary.key !== active.key) {
      // Hand the camera over once, on change only. Repeating this every frame
      // would compound rounding into visible drift.
      const scaled = rescalePosition(
        viewer.camera.position.length(),
        active.unitInMetres,
        selection.primary.unitInMetres,
      );
      viewer.camera.position.setLength(scaled);
      active = selection.primary;
    }

    primary = renderers.find((r) => r.def.key === selection.primary.key) ?? primary;

    for (const renderer of renderers) {
      renderer.applyActiveLayer(active);
      if (renderer.def.key === selection.primary.key) {
        renderer.setOpacity(opacityForBlend('primary', selection.secondary ? selection.blend : 0));
      } else if (renderer.def.key === selection.secondary?.key) {
        renderer.setOpacity(opacityForBlend('secondary', selection.blend));
      } else {
        renderer.setOpacity(0);
      }
      renderer.update({
        position: viewer.camera.position,
        screenHeight: viewer.renderer.domElement.height,
        fovRadians: (viewer.camera.fov * Math.PI) / 180,
      });
    }

    scaleHud.update(viewer.camera.position.length() * active.unitInMetres, active.key);

    earth.update(viewer.camera, window.innerWidth, window.innerHeight);

    const showing = modeledRenderers.filter((r) => r.currentOpacity > 0);
    if (showing.length > 0) {
      modeledNotice.setFraction(Math.max(...showing.map((r) => r.modeledFraction())));
    }
    modeledNotice.setVisible(showing.length > 0);
  });

  viewer.start();
  window.__universeMap = {
    viewer,
    get manager() {
      return primary.manager;
    },
    get tileset() {
      return primary.tileset;
    },
    frameTimes,
    picking,
    hover,
    identifiersReady,
    layers: renderers,
    selection: () => selection,
    activeLayer: () => active,
    modeledNotice,
  };
  console.info(`layers loaded: ${renderers.map((r) => r.def.key).join(', ')}`);
}

void boot();
