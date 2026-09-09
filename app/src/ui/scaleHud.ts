const AU_IN_METRES = 149597870700;
const LY_IN_METRES = 9460730472580800;
const MLY_IN_METRES = LY_IN_METRES * 1e6;
const GLY_IN_METRES = LY_IN_METRES * 1e9;

function decimalsFor(value: number): number {
  if (value >= 100) return 0;
  if (value >= 1) return 1;
  if (value > 0) return Math.min(12, 2 - Math.floor(Math.log10(value)));
  return 0;
}

function formatValue(value: number): string {
  const decimals = decimalsFor(value);
  // toLocaleString in decimal style never emits an exponent, which toString and
  // toPrecision both do below 1e-6 and above 1e21.
  return value.toLocaleString('en-US', {
    minimumFractionDigits: value >= 1 ? decimals : 0,
    maximumFractionDigits: decimals,
    useGrouping: true,
  });
}

export function formatDistance(metres: number): string {
  if (!Number.isFinite(metres) || metres <= 0) return '0 AU';
  if (metres < LY_IN_METRES) return `${formatValue(metres / AU_IN_METRES)} AU`;
  if (metres < LY_IN_METRES * 1e6) return `${formatValue(metres / LY_IN_METRES)} ly`;
  if (metres < GLY_IN_METRES) return `${formatValue(metres / MLY_IN_METRES)} Mly`;
  return `${formatValue(metres / GLY_IN_METRES)} Gly`;
}

export function layerDisplayName(key: string): string {
  return key
    .split('-')
    .map((word) => (word ? word[0]!.toUpperCase() + word.slice(1) : word))
    .join(' ');
}

export class ScaleHud {
  readonly element: HTMLDivElement;
  private readonly distanceElement: HTMLSpanElement;
  private readonly layerElement: HTMLSpanElement;
  private last = '';

  constructor(parent: HTMLElement) {
    this.element = document.createElement('div');
    this.element.setAttribute('data-testid', 'scale-hud');
    this.element.style.cssText = [
      'position:fixed',
      'left:12px',
      'bottom:12px',
      'pointer-events:none',
      'padding:6px 10px',
      'font:12px/1.5 ui-monospace,monospace',
      'color:#e8f1ff',
      'background:rgba(8,12,22,0.82)',
      'border:1px solid rgba(120,160,220,0.35)',
      'border-radius:4px',
      'z-index:25',
    ].join(';');

    this.distanceElement = document.createElement('span');
    this.distanceElement.style.cssText = 'color:#ffffff;font-weight:600';
    this.layerElement = document.createElement('span');
    this.layerElement.style.cssText = 'color:#9fb4d4';

    this.element.appendChild(this.distanceElement);
    this.element.appendChild(document.createTextNode(' from Earth · '));
    this.element.appendChild(this.layerElement);
    parent.appendChild(this.element);
  }

  update(distanceMetres: number, layerName: string): void {
    const distance = formatDistance(distanceMetres);
    const layer = layerDisplayName(layerName);
    const next = `${distance}|${layer}`;
    if (next === this.last) return;
    this.last = next;
    this.distanceElement.textContent = distance;
    this.layerElement.textContent = layer;
  }

  dispose(): void {
    this.element.remove();
  }
}
