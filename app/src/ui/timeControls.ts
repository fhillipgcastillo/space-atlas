import { clampYears, formatYears, MAX_YEARS, MIN_YEARS } from '../render/timeline.js';
import { FLAG_MODELED, FLAG_NO_RADIAL_VELOCITY } from '../render/typeFlags.js';

export interface TimeStats {
  /** Share of the catalogued (non-modeled) objects; NaN when none were sampled. */
  noRadialVelocityFraction: number;
  modeledFraction: number;
}

export interface FlagSource {
  typeFlags: ArrayLike<number>;
  pointCount: number;
}

// Prime, so the walk never lands in step with the tile's own point ordering.
const SAMPLE_STRIDE = 97;

export const RATES = [1_000, 10_000, 100_000] as const;

function sharePercent(fraction: number): number {
  if (!Number.isFinite(fraction) || fraction <= 0) return 0;
  if (fraction >= 1) return 100;
  // A population that exists must not round away to 0%, nor a mixed one to 100%.
  return Math.min(Math.max(Math.round(fraction * 100), 1), 99);
}

export function timeDisclosure(stats: TimeStats): string {
  const modeled = sharePercent(stats.modeledFraction);
  const parts: string[] = [];

  if (Number.isFinite(stats.noRadialVelocityFraction)) {
    const noRadial = sharePercent(stats.noRadialVelocityFraction);
    parts.push(
      noRadial === 0
        ? 'Every catalogued object in view carries a measured radial velocity.'
        : `${noRadial}% of the catalogued objects in view have no measured radial velocity. They drift on transverse motion alone, with the line-of-sight component substituted as zero, so their direction of travel is partly invented.`,
    );
  }

  if (modeled > 0) {
    parts.push(
      `${modeled}% of what is on screen is a modeled population with no kinematics at all: those points stay perfectly still while everything else moves.`,
    );
  }

  parts.push(
    'Past about a million years the straight-line extrapolation stops being physical, which is where this range ends.',
  );

  return parts.join(' ');
}

/**
 * Flag fractions over every SAMPLE_STRIDE-th point of the tiles handed in.
 * Modeled points carry FLAG_NO_RADIAL_VELOCITY as well, so they are excluded
 * from the radial-velocity share: they do not move at all.
 */
export function sampleTimeStats(
  tiles: Iterable<FlagSource>,
): TimeStats & { sampled: number; catalogued: number } {
  let sampled = 0;
  let catalogued = 0;
  let noRadial = 0;
  let modeled = 0;
  for (const tile of tiles) {
    for (let i = 0; i < tile.pointCount; i += SAMPLE_STRIDE) {
      const flags = tile.typeFlags[i] ?? 0;
      sampled++;
      if ((flags & FLAG_MODELED) !== 0) {
        modeled++;
        continue;
      }
      catalogued++;
      if ((flags & FLAG_NO_RADIAL_VELOCITY) !== 0) noRadial++;
    }
  }
  return {
    noRadialVelocityFraction: catalogued > 0 ? noRadial / catalogued : Number.NaN,
    modeledFraction: sampled > 0 ? modeled / sampled : 0,
    sampled,
    catalogued,
  };
}

// Top right: the search box owns the top left and its result list drops over
// anything centred there.
const PANEL_CSS = [
  'position:fixed',
  'right:12px',
  'top:12px',
  'width:300px',
  'padding:8px 10px',
  'font:12px/1.6 ui-monospace,monospace',
  'color:#e8f1ff',
  'background:rgba(8,12,22,0.82)',
  'border:1px solid rgba(120,160,220,0.35)',
  'border-radius:4px',
  'z-index:25',
].join(';');

const BUTTON_CSS = [
  'font:inherit',
  'color:#e8f1ff',
  'background:#0d1422',
  'border:1px solid rgba(120,160,220,0.35)',
  'border-radius:3px',
  'padding:2px 8px',
  'cursor:pointer',
].join(';');

export class TimeControls {
  private readonly element: HTMLDivElement;
  private readonly slider: HTMLInputElement;
  private readonly readout: HTMLSpanElement;
  private readonly playButton: HTMLButtonElement;
  private readonly rateSelect: HTMLSelectElement;
  private readonly disclosure: HTMLDivElement;
  private years = 0;
  private playing = false;
  private rate: number = RATES[1];
  private disclosureText = '';

  constructor(
    parent: HTMLElement,
    private readonly onChange: (years: number) => void = () => {},
  ) {
    this.element = document.createElement('div');
    this.element.setAttribute('data-testid', 'time-controls');
    this.element.style.cssText = PANEL_CSS;

    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:6px';

    this.playButton = document.createElement('button');
    this.playButton.type = 'button';
    this.playButton.setAttribute('data-testid', 'time-play');
    this.playButton.style.cssText = BUTTON_CSS;
    this.playButton.addEventListener('click', () => this.setPlaying(!this.playing));

    this.slider = document.createElement('input');
    this.slider.type = 'range';
    this.slider.min = String(MIN_YEARS);
    this.slider.max = String(MAX_YEARS);
    this.slider.step = '1000';
    this.slider.value = '0';
    this.slider.setAttribute('data-testid', 'time-slider');
    this.slider.style.cssText = 'width:100%;margin-top:6px';
    this.slider.addEventListener('input', () => {
      this.setPlaying(false);
      this.setYears(Number.parseFloat(this.slider.value));
    });

    this.readout = document.createElement('span');
    this.readout.setAttribute('data-testid', 'time-readout');
    this.readout.style.cssText =
      'flex:1;text-align:right;white-space:nowrap;color:#ffffff;font-weight:600';

    this.rateSelect = document.createElement('select');
    this.rateSelect.setAttribute('data-testid', 'time-rate');
    this.rateSelect.style.cssText = BUTTON_CSS;
    for (const rate of RATES) {
      const option = document.createElement('option');
      option.value = String(rate);
      option.textContent = `${rate / 1000}k yr/s`;
      option.selected = rate === this.rate;
      this.rateSelect.appendChild(option);
    }
    this.rateSelect.addEventListener('change', () => {
      this.rate = Number.parseFloat(this.rateSelect.value) || RATES[1];
    });

    const resetButton = document.createElement('button');
    resetButton.type = 'button';
    resetButton.textContent = 'Now';
    resetButton.setAttribute('data-testid', 'time-reset');
    resetButton.style.cssText = BUTTON_CSS;
    resetButton.addEventListener('click', () => this.reset());

    row.append(this.playButton, resetButton, this.rateSelect, this.readout);
    this.element.append(row, this.slider);

    this.disclosure = document.createElement('div');
    this.disclosure.setAttribute('data-testid', 'time-disclosure');
    this.disclosure.hidden = true;
    this.disclosure.style.cssText = [
      'margin-top:6px',
      'font:12px/1.5 ui-monospace,monospace',
      'color:#ffd9a8',
      'background:rgba(30,16,6,0.9)',
      'border:1px solid rgba(255,180,90,0.45)',
      'border-radius:4px',
      'padding:6px 9px',
    ].join(';');
    this.element.appendChild(this.disclosure);

    parent.appendChild(this.element);
    this.setPlaying(false);
    this.render();
  }

  get currentYears(): number {
    return this.years;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  get currentRate(): number {
    return this.rate;
  }

  setYears(years: number): void {
    const next = clampYears(years);
    if (next === this.years) return;
    this.years = next;
    this.render();
    this.onChange(next);
  }

  setPlaying(playing: boolean): void {
    this.playing = playing;
    this.playButton.textContent = playing ? 'Pause' : 'Play';
  }

  setRate(rate: number): void {
    if (Number.isFinite(rate) && rate > 0) this.rate = rate;
    this.rateSelect.value = String(this.rate);
  }

  reset(): void {
    this.setPlaying(false);
    this.setYears(0);
  }

  advance(dt: number): void {
    if (!this.playing) return;
    const next = this.years + this.rate * dt;
    this.setYears(next);
    if (this.years >= MAX_YEARS || this.years <= MIN_YEARS) this.setPlaying(false);
  }

  setStats(stats: TimeStats): void {
    const text = timeDisclosure(stats);
    if (text === this.disclosureText) return;
    this.disclosureText = text;
    this.disclosure.textContent = text;
  }

  dispose(): void {
    this.element.remove();
  }

  private render(): void {
    this.slider.value = String(this.years);
    this.readout.textContent = formatYears(this.years);
    this.disclosure.hidden = this.years === 0;
  }
}
