import { Group, type RawShaderMaterial } from 'three';
import { createPointMaterial } from '../render/pointMaterial.js';
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

  setOpacity(value: number): void {
    this.opacity = Math.min(Math.max(value, 0), 1);
    this.group.visible = this.opacity > 0;
    this.setUniform('uLayerOpacity', this.opacity);
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
    this.manager.update(view);
  }

  dispose(): void {
    this.manager.dispose();
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
