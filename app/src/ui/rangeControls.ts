export type RangeMode = 'earth' | 'camera';

export interface RangeCutoffs {
  /** Radius shell on the layer origin. A map filter: unchanged by camera motion. */
  fromEarth: number;
  /** Draw distance travelling with the viewer. */
  fromCamera: number;
}

export const UNLIMITED = Number.POSITIVE_INFINITY;

export const NO_CUTOFFS: RangeCutoffs = { fromEarth: UNLIMITED, fromCamera: UNLIMITED };

/** A blank, negative, zero or unparseable entry means no limit rather than an empty sky. */
export function normaliseCutoff(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return UNLIMITED;
  return value;
}

export function withCutoff(cutoffs: RangeCutoffs, mode: RangeMode, value: number): RangeCutoffs {
  const limit = normaliseCutoff(value);
  return mode === 'earth'
    ? { fromEarth: limit, fromCamera: cutoffs.fromCamera }
    : { fromEarth: cutoffs.fromEarth, fromCamera: limit };
}

export function cutoffOf(cutoffs: RangeCutoffs, mode: RangeMode): number {
  return mode === 'earth' ? cutoffs.fromEarth : cutoffs.fromCamera;
}

/** The unit is never optional: without the active layer's unit the number means nothing. */
export function formatCutoff(value: number, unit: string): string {
  if (!Number.isFinite(value)) return 'unlimited';
  return `${value.toLocaleString('en-US', { maximumFractionDigits: 3 })} ${unit}`;
}

export function modeLabel(mode: RangeMode): string {
  return mode === 'earth' ? 'From Earth' : 'From camera';
}

const MODES: RangeMode[] = ['earth', 'camera'];

export class RangeControls {
  private readonly element: HTMLDivElement;
  private readonly input: HTMLInputElement;
  private readonly unitElement: HTMLSpanElement;
  private readonly summary: HTMLDivElement;
  private readonly radios = new Map<RangeMode, HTMLInputElement>();
  private cutoffs: RangeCutoffs = NO_CUTOFFS;
  private mode: RangeMode = 'earth';
  private unit = '';

  constructor(
    parent: HTMLElement,
    private readonly onChange: (cutoffs: RangeCutoffs) => void = () => {},
  ) {
    this.element = document.createElement('div');
    this.element.setAttribute('data-testid', 'range-controls');
    this.element.style.cssText = [
      'position:fixed',
      'right:12px',
      'bottom:12px',
      'padding:8px 10px',
      'font:12px/1.6 ui-monospace,monospace',
      'color:#e8f1ff',
      'background:rgba(8,12,22,0.82)',
      'border:1px solid rgba(120,160,220,0.35)',
      'border-radius:4px',
      'z-index:25',
    ].join(';');

    const title = document.createElement('div');
    title.textContent = 'Max render distance';
    title.style.cssText = 'color:#9fb4d4;margin-bottom:4px';
    this.element.appendChild(title);

    for (const mode of MODES) {
      const label = document.createElement('label');
      label.style.cssText = 'display:inline-block;margin-right:10px;cursor:pointer';
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'range-mode';
      radio.value = mode;
      radio.checked = mode === this.mode;
      radio.setAttribute('data-testid', `range-mode-${mode}`);
      radio.addEventListener('change', () => {
        if (radio.checked) this.setMode(mode);
      });
      label.appendChild(radio);
      label.appendChild(document.createTextNode(` ${modeLabel(mode)}`));
      this.radios.set(mode, radio);
      this.element.appendChild(label);
    }

    const row = document.createElement('div');
    row.style.cssText = 'margin-top:4px';
    this.input = document.createElement('input');
    this.input.type = 'number';
    this.input.min = '0';
    this.input.step = 'any';
    this.input.placeholder = 'unlimited';
    this.input.setAttribute('data-testid', 'range-value');
    this.input.style.cssText = 'width:90px;background:#0d1422;color:#e8f1ff;border:1px solid rgba(120,160,220,0.35);border-radius:3px;padding:2px 4px';
    this.input.addEventListener('input', () => {
      this.apply(withCutoff(this.cutoffs, this.mode, Number.parseFloat(this.input.value)));
    });
    this.unitElement = document.createElement('span');
    this.unitElement.style.cssText = 'color:#9fb4d4;margin-left:6px';
    row.appendChild(this.input);
    row.appendChild(this.unitElement);
    this.element.appendChild(row);

    this.summary = document.createElement('div');
    this.summary.setAttribute('data-testid', 'range-summary');
    this.summary.style.cssText = 'color:#9fb4d4;margin-top:4px';
    this.element.appendChild(this.summary);

    parent.appendChild(this.element);
    this.render();
  }

  get current(): RangeCutoffs {
    return this.cutoffs;
  }

  get editing(): RangeMode {
    return this.mode;
  }

  /** Selects which cutoff the input edits. Neither mode is switched off by this. */
  setMode(mode: RangeMode): void {
    this.mode = mode;
    const radio = this.radios.get(mode);
    if (radio) radio.checked = true;
    this.render();
  }

  setCutoff(mode: RangeMode, value: number): void {
    this.apply(withCutoff(this.cutoffs, mode, value));
    this.render();
  }

  clear(mode: RangeMode): void {
    this.setCutoff(mode, UNLIMITED);
  }

  setUnit(unit: string): void {
    if (unit === this.unit) return;
    this.unit = unit;
    this.render();
  }

  dispose(): void {
    this.element.remove();
  }

  private apply(next: RangeCutoffs): void {
    this.cutoffs = next;
    this.summary.textContent = this.summaryText();
    this.onChange(next);
  }

  private summaryText(): string {
    return MODES.map((m) => `${modeLabel(m)}: ${formatCutoff(cutoffOf(this.cutoffs, m), this.unit)}`)
      .join(' · ');
  }

  private render(): void {
    const value = cutoffOf(this.cutoffs, this.mode);
    this.input.value = Number.isFinite(value) ? String(value) : '';
    this.unitElement.textContent = this.unit;
    this.summary.textContent = this.summaryText();
  }
}
