import { Group, type RawShaderMaterial } from 'three';
import { createPointMaterial, NO_CUTOFF } from '../render/pointMaterial.js';
import { FLAG_MODELED } from '../render/typeFlags.js';
import type { DecodedTile } from '../tiles/format.js';
import { TileManager } from '../tiles/tileManager.js';
import { fetchTileset, type Tileset } from '../tiles/tileset.js';
import type { ViewState } from '../tiles/traversal.js';
import { layerScaleFactor, type LayerDef } from './stack.js';

const METRES_PER_PARSEC = 3.0856775814913673e16;

export function opacityForBlend(role: 'primary' | 'secondary', blend: number): number {
  const clamped = Math.min(Math.max(blend, 0), 1);
  return role === 'primary' ? 1 - clamped : clamped;
}

export class LayerRenderer {
  readonly group = new Group();
  private opacity = 1;
  private originCutoff = Number.POSITIVE_INFINITY;
  private cameraCutoff = Number.POSITIVE_INFINITY;
  private readonly modeledCounts = new WeakMap<DecodedTile, number>();

  private constructor(
    readonly def: LayerDef,
    readonly tileset: Tileset,
    readonly manager: TileManager,
    private readonly material: RawShaderMaterial,
  ) {
    this.group.add(manager.group);
  }

  static async create(def: LayerDef, unitInParsecs: number): Promise<LayerRenderer> {
    const tileset = await fetchTileset(def.url);
    const material = createPointMaterial(unitInParsecs);
    const manager = new TileManager(def.url, tileset, material);
    return new LayerRenderer(def, tileset, manager, material);
  }

  get currentOpacity(): number {
    return this.opacity;
  }

  setModeledDim(value: number): void {
    this.setUniform('uModeledDim', Math.min(Math.max(value, 0), 1));
  }

  setShowModeled(show: boolean): void {
    this.setUniform('uShowModeled', show ? 1 : 0);
  }

  /** Modeled share of the points currently drawn, so the notice can report it. */
  modeledFraction(): number {
    let total = 0;
    let modeled = 0;
    for (const { tile, mesh } of this.manager.tilesBySlot.values()) {
      if (!mesh.visible) continue;
      total += tile.pointCount;
      modeled += this.modeledCountOf(tile);
    }
    return total > 0 ? modeled / total : 0;
  }

  setOpacity(value: number): void {
    this.opacity = Math.min(Math.max(value, 0), 1);
    this.group.visible = this.opacity > 0;
    this.setUniform('uLayerOpacity', this.opacity);
  }

  /**
   * Both cutoffs arrive in the active layer's units. The camera one stays there
   * because the shader measures it in view space; the origin shell converts to
   * this layer's own units, which is what its positions and boxes are in.
   */
  setRangeCutoffs(fromEarth: number, fromCamera: number, active: LayerDef): void {
    const origin = fromEarth / layerScaleFactor(this.def, active);
    if (origin === this.originCutoff && fromCamera === this.cameraCutoff) return;
    this.originCutoff = origin;
    this.cameraCutoff = fromCamera;
    this.setUniform('uMaxOriginDistance', Number.isFinite(origin) ? origin : NO_CUTOFF);
    this.setUniform('uMaxCameraDistance', Number.isFinite(fromCamera) ? fromCamera : NO_CUTOFF);
  }

  applyActiveLayer(active: LayerDef): void {
    this.group.scale.setScalar(layerScaleFactor(this.def, active));
    // The group scale sits inside modelViewMatrix, so the shader measures
    // distance in the active layer's units, never in this layer's own.
    this.setUniform('uParsecsPerUnit', active.unitInMetres / METRES_PER_PARSEC);
  }

  update(view: ViewState): void {
    // An invisible layer must not stream: it would compete for the eight
    // in-flight slots with the layer actually on screen.
    if (this.opacity <= 0) return;
    this.manager.update({
      ...view,
      maxCameraDistance: this.cameraCutoff,
      maxOriginDistance: this.originCutoff,
    });
  }

  dispose(): void {
    this.manager.dispose();
  }

  private modeledCountOf(tile: DecodedTile): number {
    const cached = this.modeledCounts.get(tile);
    if (cached !== undefined) return cached;
    let count = 0;
    for (let i = 0; i < tile.pointCount; i++) {
      if (((tile.typeFlags[i] ?? 0) & FLAG_MODELED) !== 0) count++;
    }
    this.modeledCounts.set(tile, count);
    return count;
  }

  // createTileMesh clones this material per tile, so the base has to be written
  // too or tiles that stream in later inherit a stale value.
  private setUniform(name: string, value: number): void {
    for (const mesh of this.manager.meshes.values()) {
      if (Array.isArray(mesh.material)) continue;
      const uniform = (mesh.material as RawShaderMaterial).uniforms[name];
      if (uniform) uniform.value = value;
    }
    const base = this.material.uniforms[name];
    if (base) base.value = value;
  }
}
