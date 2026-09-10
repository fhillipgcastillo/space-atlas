export interface StatsSample {
  frameMs: readonly number[];
  points: number;
  calls: number;
  geometries: number;
  textures: number;
  tilesLoaded: number;
  tilesVisible: number;
  inFlight: number;
  labelCandidates: number;
  layerKey: string;
  distance: string;
}

const PANEL_CSS = [
  'position:fixed',
  'right:12px',
  'bottom:96px',
  'min-width:190px',
  'padding:8px 10px',
  'font:12px/1.5 ui-monospace,monospace',
  'color:#e8f1ff',
  'background:rgba(8,12,22,0.82)',
  'border:1px solid rgba(120,160,220,0.35)',
  'border-radius:4px',
  'z-index:26',
  'pointer-events:none',
].join(';');

// DOM writes are not free at 8M points; four updates a second reads as live.
const REFRESH_SECONDS = 0.25;

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return sorted[i]!;
}

function compact(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return String(n);
}

export class StatsPanel {
  readonly element: HTMLDivElement;

  private visible = false;
  private since = REFRESH_SECONDS;
  private readonly rows = new Map<string, HTMLSpanElement>();

  constructor(parent: HTMLElement) {
    this.element = document.createElement('div');
    this.element.setAttribute('data-testid', 'stats-panel');
    this.element.style.cssText = PANEL_CSS;
    this.element.hidden = true;
    parent.appendChild(this.element);
  }

  isVisible(): boolean {
    return this.visible;
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.element.hidden = !visible;
    // Show real numbers on the next frame rather than whatever was last drawn.
    if (visible) this.since = REFRESH_SECONDS;
  }

  update(dt: number, sample: () => StatsSample): void {
    if (!this.visible) return;
    this.since += dt;
    if (this.since < REFRESH_SECONDS) return;
    this.since = 0;

    const s = sample();
    const recent = s.frameMs.slice(-120);
    const sorted = [...recent].sort((a, b) => a - b);
    const mean = recent.length ? recent.reduce((a, b) => a + b, 0) / recent.length : 0;

    this.set('fps', mean > 0 ? (1000 / mean).toFixed(1) : '--');
    this.set('frame', `${mean.toFixed(1)} ms  p95 ${percentile(sorted, 0.95).toFixed(1)}`);
    this.set('points', compact(s.points));
    this.set('draw calls', String(s.calls));
    this.set('tiles', `${s.tilesVisible} shown / ${s.tilesLoaded} held`);
    this.set('loading', String(s.inFlight));
    this.set('labels scanned', compact(s.labelCandidates));
    this.set('geometries', String(s.geometries));
    this.set('textures', String(s.textures));
    this.set('layer', s.layerKey);
    this.set('distance', s.distance);
  }

  dispose(): void {
    this.element.remove();
  }

  private set(label: string, value: string): void {
    let node = this.rows.get(label);
    if (!node) {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;justify-content:space-between;gap:12px';
      const caption = document.createElement('span');
      caption.textContent = label;
      caption.style.cssText = 'color:#9fb4d4';
      node = document.createElement('span');
      row.append(caption, node);
      this.element.appendChild(row);
      this.rows.set(label, node);
    }
    if (node.textContent !== value) node.textContent = value;
  }
}
