import { Vector3 } from 'three';
import { Viewer } from './core/viewer.js';
import { Anchor } from './interaction/anchors.js';
import { HoverController } from './interaction/hover.js';
import { buildCandidates, declutter, LabelLayer, type NamedObject } from './interaction/labels.js';
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
import { RangeControls } from './ui/rangeControls.js';
import { ScaleHud } from './ui/scaleHud.js';
import { SearchBox } from './ui/searchBox.js';
import { StatsPanel } from './ui/statsPanel.js';
import { createControlPanel, type ControlPanel } from './ui/controlPanel.js';
import { sampleTimeStats, TimeControls } from './ui/timeControls.js';

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
      ownerForSlot: (slot: number) => LayerRenderer | undefined;
      labelObjects: Map<string, NamedObject[]>;
      selection: () => LayerSelection;
      activeLayer: () => LayerDef;
      modeledNotice: ModeledNotice;
      rangeControls: RangeControls;
      timeControls: TimeControls;
      controlPanel: ControlPanel;
      statsPanel: StatsPanel;
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
  // During a crossfade both layers paint into the one pick target, so a hit can
  // belong to either; slots are unique across managers, so the owner is found.
  const ownerForSlot = (slot: number): LayerRenderer | undefined =>
    renderers.find((renderer) => renderer.manager.tilesBySlot.has(slot));
  let hovered = primary;
  const hover = new HoverController(
    picking,
    card,
    {
      get unit() {
        return hovered.def.unit;
      },
      get origin() {
        return hovered.tileset.origin;
      },
      // HoverController resolves the slot before it reads any of the fields
      // around this one, so they describe the layer the hit came from.
      tileForSlot: (slot) => {
        const owner = ownerForSlot(slot);
        if (!owner) return undefined;
        hovered = owner;
        return owner.manager.tilesBySlot.get(slot);
      },
      identify: (tile, index) => {
        const local = tile.localId[index];
        if (local === undefined) return undefined;
        const key = hovered.def.key;
        const named = names.get(key)?.get(local);
        if (named !== undefined) return named;
        const id = identifiers.get(key)?.[local];
        if (id === undefined) return undefined;
        const prefix = hovered.tileset.idPrefix;
        return prefix ? `${prefix} ${id}` : String(id);
      },
    },
    viewer.renderer.domElement,
  );

  const earth = new Anchor('Earth', new Vector3(0, 0, 0), document.body);
  const modeledNotice = new ModeledNotice(document.body);
  const scaleHud = new ScaleHud(document.body);
  const labelLayer = new LabelLayer(document.body);
  const LABEL_BOX = { width: 120, height: 16 };
  const MAX_LABELS = 40;
  const MAX_LABEL_OBJECTS = 4000;
  // Keyed by layer, so only what is on screen contributes. The source is the
  // names index, so modeled points can never appear here.
  const labelObjects = new Map<string, NamedObject[]>();
  const rangeControls = new RangeControls(document.body);
  const statsPanel = new StatsPanel(document.body);
  let labelsScanned = 0;
  const timeControls = new TimeControls(
    document.body,
    (years) => viewer.setTimeYears(years),
    (deep) => {
      for (const renderer of renderers) renderer.setDeepTime(deep);
    },
  );
  // Walking the live tiles for flag fractions is only worth it while the clock
  // is off present day, and only a few times a second.
  const STATS_INTERVAL = 0.5;
  let sinceStats = STATS_INTERVAL;
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
      renderer.setRangeCutoffs(
        rangeControls.current.fromEarth,
        rangeControls.current.fromCamera,
        active,
      );
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
    rangeControls.setUnit(active.unit);

    earth.update(viewer.camera, window.innerWidth, window.innerHeight);

    const named = [
      ...(labelObjects.get(selection.primary.key) ?? []),
      ...(selection.secondary ? (labelObjects.get(selection.secondary.key) ?? []) : []),
    ];
    labelsScanned = named.length;
    labelLayer.update(
      declutter(
        buildCandidates(
          named,
          viewer.camera,
          window.innerWidth,
          window.innerHeight,
          active.unitInMetres,
        ),
        LABEL_BOX,
        MAX_LABELS,
      ),
    );

    // The clock is shared, so a time set through the viewer has to reach the UI.
    // The shared clock is capped at the linear range, so past it the control owns
    // the time and writes it to the layers after their own update read the clock.
    if (!timeControls.isDeep) timeControls.setYears(viewer.getTimeYears());
    timeControls.advance(dt);
    if (timeControls.isDeep) {
      for (const renderer of renderers) renderer.setTimeYears(timeControls.currentYears);
    }
    sinceStats += dt;
    if (timeControls.currentYears === 0) sinceStats = STATS_INTERVAL;
    else if (sinceStats >= STATS_INTERVAL) {
      sinceStats = 0;
      timeControls.setStats(
        sampleTimeStats(
          renderers
            .filter((r) => r.currentOpacity > 0)
            .flatMap((r) =>
              [...r.manager.tilesBySlot.values()].filter((e) => e.mesh.visible).map((e) => e.tile),
            ),
        ),
      );
    }

    statsPanel.update(dt, () => {
      const info = viewer.renderer.info;
      let visible = 0;
      for (const { mesh } of primary.manager.tilesBySlot.values()) if (mesh.visible) visible++;
      return {
        frameMs: frameTimes,
        points: info.render.points,
        calls: info.render.calls,
        geometries: info.memory.geometries,
        textures: info.memory.textures,
        tilesLoaded: primary.manager.meshes.size,
        tilesVisible: visible,
        inFlight: primary.manager.inFlightCount,
        labelCandidates: labelsScanned,
        layerKey: active.key,
        distance: `${viewer.camera.position.length().toPrecision(4)} ${active.unit}`,
      };
    });

    const showing = modeledRenderers.filter((r) => r.currentOpacity > 0);
    if (showing.length > 0) {
      modeledNotice.setFraction(Math.max(...showing.map((r) => r.modeledFraction())));
    }
    modeledNotice.setVisible(showing.length > 0);
  });

  const flyTo = new FlyTo();
  const searchEntries: SearchEntry[] = [];
  const searchBox = new SearchBox(document.body, (entry) => {
    const target = LAYERS.find((def) => def.key === entry.layerKey);
    if (target) flyTo.start(entry, target, viewer.camera, active);
  });
  // Runs after the callback above, so the layer handover has already happened
  // and this writes the position in the layer that won.
  viewer.onFrame((dt) => flyTo.update(dt, viewer.camera, active));
  // Walking the tiles for named positions costs tens of megabytes on the
  // milky-way layer, so it is never awaited; each layer lands as it finishes.
  void buildSearchIndex(LAYERS, (entries) => {
    // Spreading instead would overflow the stack: the cosmic-web layer alone
    // lands 423,578 names in one call.
    for (const entry of entries) {
      searchEntries.push(entry);
      const def = LAYERS.find((l) => l.key === entry.layerKey);
      if (!def) continue;
      const bucket = labelObjects.get(entry.layerKey) ?? [];
      // buildCandidates projects every one of these every frame, and cosmic-web
      // alone carries 423,578 names. Only MAX_LABELS survive declutter, so the
      // cap costs nothing visible and bounds the per-frame work.
      if (bucket.length < MAX_LABEL_OBJECTS) {
        bucket.push({ name: entry.name, position: entry.position, unitInMetres: def.unitInMetres });
      }
      labelObjects.set(entry.layerKey, bucket);
    }
    searchBox.setEntries(searchEntries);
  });

  // Built last: the hamburger hides every other panel, so they all have to
  // exist before it takes their elements.
  const controlPanel = createControlPanel(document.body, {
    viewer,
    layers: renderers,
    labels: labelLayer,
    stats: statsPanel,
    chrome: [
      scaleHud.element,
      rangeControls.element,
      timeControls.element,
      searchBox.root,
      modeledNotice.element,
      earth.element,
      statsPanel.element,
    ],
    toggleKey: 'Escape',
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
    ownerForSlot,
    labelObjects,
    selection: () => selection,
    activeLayer: () => active,
    modeledNotice,
    rangeControls,
    timeControls,
    controlPanel,
    statsPanel,
  };
  console.info(`layers loaded: ${renderers.map((r) => r.def.key).join(', ')}`);
}

void boot();
