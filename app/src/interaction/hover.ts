import type { Points } from 'three';
import type { PickingPass } from '../render/picking.js';
import { dequantizePosition, type DecodedTile } from '../tiles/format.js';
import type { HoverCard } from '../ui/hoverCard.js';

export interface HoverSource {
  tileForSlot(slot: number): { tile: DecodedTile; mesh: Points } | undefined;
  catalogId(tile: DecodedTile, vertexIndex: number): bigint | undefined;
  unit: string;
}

const scratch = new Float64Array(3);

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

    dequantizePosition(entry.tile, hit.vertexIndex, scratch);
    const distance = Math.hypot(scratch[0]!, scratch[1]!, scratch[2]!);
    const catalogId = this.source.catalogId(entry.tile, hit.vertexIndex);

    this.card.show(
      [
        catalogId === undefined ? 'Star' : `Gaia DR3 ${catalogId}`,
        `${distance.toFixed(2)} ${this.source.unit} from Earth`,
      ].join('\n'),
      x,
      y,
    );
    return true;
  }
}
