import type { Points, RawShaderMaterial } from 'three';
import type { PickingPass } from '../render/picking.js';
import { decodeFloat16, dequantizePosition, type DecodedTile } from '../tiles/format.js';
import { describeType, hasMeasuredMagnitude, hasRadialVelocity } from '../render/typeFlags.js';
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

/** Distance from the layer origin to a point after `timeYears` of its measured drift. */
export function distanceAtTime(
  tile: DecodedTile,
  index: number,
  timeYears: number,
  velocityScale: number,
): number {
  dequantizePosition(tile, index, scratch);
  let sum = 0;
  for (let axis = 0; axis < 3; axis++) {
    const velocity = decodeFloat16(tile.velocity[index * 3 + axis] ?? 0);
    const coord = scratch[axis]! + velocity * timeYears * velocityScale;
    sum += coord * coord;
  }
  return Math.sqrt(sum);
}

function uniformValue(mesh: Points, name: string): number {
  const uniforms = (mesh.material as RawShaderMaterial).uniforms;
  const value = uniforms?.[name]?.value;
  return typeof value === 'number' ? value : 0;
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
