import { Vector3, type Points, type RawShaderMaterial } from 'three';
import type { PickingPass } from '../render/picking.js';
import { decodeFloat16, dequantizePosition, type DecodedTile } from '../tiles/format.js';
import {
  circularSpeed,
  orbitPosition,
  R0_PC,
  Z_SUN_PC,
  type Vec3,
} from '../render/galacticOrbit.js';
import { DEEP_MODEL_HUBBLE, DEEP_MODEL_ORBIT } from '../render/pointMaterial.js';
import {
  describeType,
  FLAG_MODELED,
  hasMeasuredMagnitude,
  hasRadialVelocity,
} from '../render/typeFlags.js';
import type { HoverCard } from '../ui/hoverCard.js';

export interface HoverSource {
  tileForSlot(slot: number): { tile: DecodedTile; mesh: Points } | undefined;
  /** Display name, else a catalogue designation, else undefined when neither is loaded. */
  identify(tile: DecodedTile, vertexIndex: number): string | undefined;
  unit: string;
  origin: string;
}

export interface HoverFields {
  label: string | undefined;
  flags: number;
  distance: number;
  unit: string;
  origin: string;
  absMag: number;
  speed: number;
}

export function hoverCardText(f: HoverFields): string {
  const type = describeType(f.flags);
  return [
    f.label ?? type,
    ...(f.label === undefined ? [] : [type]),
    `${f.distance.toFixed(2)} ${f.unit} from ${f.origin}`,
    hasMeasuredMagnitude(f.flags)
      ? `absolute magnitude ${f.absMag.toFixed(2)}`
      : `absolute magnitude ${f.absMag.toFixed(2)} (nominal)`,
    hasRadialVelocity(f.flags)
      ? `${f.speed.toFixed(1)} km/s`
      : `${f.speed.toFixed(1)} km/s (transverse only)`,
  ].join('\n');
}

const scratch = new Float64Array(3);

// Mirrors T_HUBBLE_YEARS in TIME_POSITION_GLSL.
const T_HUBBLE_YEARS = 13.97e9;

/** The deep-time branch of TIME_POSITION_GLSL, as the drawn material configures it. */
export interface DeepTimeState {
  model: number;
  layerParsecsPerUnit: number;
  solarMotionKms: Vec3;
}

function circularVelocityKms(galPc: Vec3): Vec3 {
  const r = Math.hypot(galPc[0], galPc[1]);
  if (!(r > 0)) return [0, 0, 0];
  const scale = circularSpeed(r) / r;
  return [galPc[1] * scale, -galPc[0] * scale, 0];
}

function deepPosition(
  base: Vec3,
  velocityKms: Vec3,
  modeled: boolean,
  timeYears: number,
  deep: DeepTimeState,
): Vec3 {
  const unit = deep.layerParsecsPerUnit;
  const galPc: Vec3 = [
    base[0] * unit - R0_PC,
    base[1] * unit,
    base[2] * unit + Z_SUN_PC,
  ];
  const galVelocity: Vec3 = modeled
    ? circularVelocityKms(galPc)
    : [
        velocityKms[0] + deep.solarMotionKms[0],
        velocityKms[1] + deep.solarMotionKms[1],
        velocityKms[2] + deep.solarMotionKms[2],
      ];
  const orbit = orbitPosition(galPc, galVelocity, timeYears);
  // Every modeled point stores vz = 0, and the shader holds their height fixed.
  const z = modeled ? galPc[2] : orbit[2];
  return [(orbit[0] + R0_PC) / unit, orbit[1] / unit, (z - Z_SUN_PC) / unit];
}

/**
 * Distance from the layer origin to a point at `timeYears`, following the same
 * model the material drew it with.
 */
export function distanceAtTime(
  tile: DecodedTile,
  index: number,
  timeYears: number,
  velocityScale: number,
  deep?: DeepTimeState,
): number {
  dequantizePosition(tile, index, scratch);
  const base: Vec3 = [scratch[0]!, scratch[1]!, scratch[2]!];
  const velocity: Vec3 = [
    decodeFloat16(tile.velocity[index * 3] ?? 0),
    decodeFloat16(tile.velocity[index * 3 + 1] ?? 0),
    decodeFloat16(tile.velocity[index * 3 + 2] ?? 0),
  ];

  let position: Vec3;
  if (deep?.model === DEEP_MODEL_ORBIT) {
    const modeled = ((tile.typeFlags[index] ?? 0) & FLAG_MODELED) !== 0;
    position = deepPosition(base, velocity, modeled, timeYears, deep);
  } else {
    const stretch = deep?.model === DEEP_MODEL_HUBBLE ? 1 + timeYears / T_HUBBLE_YEARS : 1;
    position = [
      base[0] * stretch + velocity[0] * timeYears * velocityScale,
      base[1] * stretch + velocity[1] * timeYears * velocityScale,
      base[2] * stretch + velocity[2] * timeYears * velocityScale,
    ];
  }

  return Math.hypot(position[0], position[1], position[2]);
}

function uniformValue(mesh: Points, name: string): number {
  const uniforms = (mesh.material as RawShaderMaterial).uniforms;
  const value = uniforms?.[name]?.value;
  return typeof value === 'number' ? value : 0;
}

function uniformVec3(mesh: Points, name: string): Vec3 {
  const value = (mesh.material as RawShaderMaterial).uniforms?.[name]?.value;
  return value instanceof Vector3 ? [value.x, value.y, value.z] : [0, 0, 0];
}

function deepStateOf(mesh: Points): DeepTimeState | undefined {
  if (uniformValue(mesh, 'uDeepTime') < 0.5) return undefined;
  return {
    model: uniformValue(mesh, 'uDeepModel'),
    layerParsecsPerUnit: uniformValue(mesh, 'uLayerParsecsPerUnit'),
    solarMotionKms: uniformVec3(mesh, 'uSolarMotion'),
  };
}

export class HoverController {
  private lastMove = 0;

  constructor(
    private readonly picking: PickingPass,
    private readonly card: HoverCard,
    private readonly source: HoverSource,
    private readonly element: HTMLElement,
    private readonly throttleMs = 33,
  ) {
    element.addEventListener('pointermove', this.onPointerMove);
    element.addEventListener('pointerleave', this.onPointerLeave);
  }

  dispose(): void {
    this.element.removeEventListener('pointermove', this.onPointerMove);
    this.element.removeEventListener('pointerleave', this.onPointerLeave);
  }

  private readonly onPointerLeave = (): void => this.card.hide();

  private readonly onPointerMove = (event: PointerEvent): void => {
    const now = performance.now();
    if (now - this.lastMove < this.throttleMs) return;
    this.lastMove = now;
    this.pick(event.clientX, event.clientY);
  };

  /** Exposed so an end-to-end test can drive a hover without a real pointer. */
  pick(x: number, y: number): boolean {
    const hit = this.picking.pickAt(x, y);
    if (!hit) {
      this.card.hide();
      return false;
    }

    const entry = this.source.tileForSlot(hit.tileSlot);
    if (!entry || hit.vertexIndex >= entry.tile.pointCount) {
      this.card.hide();
      return false;
    }

    const { tile } = entry;
    const index = hit.vertexIndex;
    // Read from the mesh that was drawn rather than the clock, so the card
    // cannot report a distance for a frame the pick pass did not see.
    const distance = distanceAtTime(
      tile,
      index,
      uniformValue(entry.mesh, 'uTimeYears'),
      uniformValue(entry.mesh, 'uVelocityScale'),
      deepStateOf(entry.mesh),
    );

    const flags = tile.typeFlags[index] ?? 0;
    const absMag = decodeFloat16(tile.absMag[index] ?? 0);
    const speed = Math.hypot(
      decodeFloat16(tile.velocity[index * 3] ?? 0),
      decodeFloat16(tile.velocity[index * 3 + 1] ?? 0),
      decodeFloat16(tile.velocity[index * 3 + 2] ?? 0),
    );

    this.card.show(
      hoverCardText({
        label: this.source.identify(tile, index),
        flags,
        distance,
        unit: this.source.unit,
        origin: this.source.origin,
        absMag,
        speed,
      }),
      x,
      y,
    );
    return true;
  }
}
