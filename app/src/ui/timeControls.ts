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

// The shared clock in timeline.ts stays capped at the linear range: it is read
// by every layer and its bound is what makes p0 + v*t defensible. Deep time is
// a separate bound owned here, and main.ts writes it to the layers directly.
export const DEEP_MAX_YEARS = 250_000_000;
export const DEEP_MIN_YEARS = -250_000_000;

// 250 Myr at 100k yr/s would take 42 minutes of wall clock to cross.
const DEEP_RATE_SCALE = 250;

export function formatDeepYears(years: number): string {
  const rounded = Math.round(years);
  if (Math.abs(rounded) <= MAX_YEARS) return formatYears(rounded);
  const millions = rounded / 1e6;
  return `${millions > 0 ? '+' : '−'}${Math.abs(millions).toFixed(1)} million years`;
}

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

export function deepTimeDisclosure(stats: TimeStats): string {
  const modeled = sharePercent(stats.modeledFraction);
  const parts: string[] = [
    'These are epicyclic orbits in an axisymmetric, static potential: no bar, no spiral arms, no scattering off molecular clouds, no mergers.',
  ];

  if (Number.isFinite(stats.noRadialVelocityFraction)) {
    const noRadial = sharePercent(stats.noRadialVelocityFraction);
    parts.push(
      noRadial === 0
        ? 'Every catalogued object in view carries a measured radial velocity.'
        : `${noRadial}% of the catalogued objects in view have no measured radial velocity, so they set out on a partly invented velocity, with the line-of-sight component substituted as zero. An orbit amplifies that error rather than diluting it: a wrong velocity is a wrong angular momentum, which is a wrong orbit for the whole run.`,
    );
  }

  if (modeled > 0) {
    parts.push(
      `${modeled}% of what is on screen is a modeled population with no measured motion at all. It is carried on assumed circular orbits, at the circular speed of its own galactocentric radius, and its vertical structure is held static.`,
    );
  }

  parts.push(
    'The epicyclic frequency comes from the rotation curve, 39.6 km/s/kpc against the 36 km/s/kpc measured locally: about 10% high.',
  );
  parts.push(
    'Against an exact integration of this same potential the closed form is off by 5.4% of galactocentric radius at 250 million years, and 2.6% at 100 million.',
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
  private readonly deepToggle: HTMLInputElement;
  private years = 0;
  private playing = false;
  private deep = false;
  private rate: number = RATES[1];
  private disclosureText = '';
  private stats: TimeStats | undefined;

  constructor(
    parent: HTMLElement,
    private readonly onChange: (years: number) => void = () => {},
    private readonly onDeepChange: (deep: boolean) => void = () => {},
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
      option.textContent = this.rateLabel(String(rate));
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

    this.deepToggle = document.createElement('input');
    this.deepToggle.type = 'checkbox';
    this.deepToggle.setAttribute('data-testid', 'time-deep');
    this.deepToggle.addEventListener('change', () => this.setDeep(this.deepToggle.checked));
    const deepLabel = document.createElement('label');
    deepLabel.style.cssText = 'display:flex;align-items:center;gap:6px;margin-top:6px;cursor:pointer';
    deepLabel.append(this.deepToggle, document.createTextNode('deep time (galactic orbits)'));

    this.element.append(row, this.slider, deepLabel);

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

  get isDeep(): boolean {
    return this.deep;
  }

  get maxYears(): number {
    return this.deep ? DEEP_MAX_YEARS : MAX_YEARS;
  }

  get minYears(): number {
    return this.deep ? DEEP_MIN_YEARS : MIN_YEARS;
  }

  setYears(years: number): void {
    const next = this.clamp(years);
    if (next === this.years) return;
    this.years = next;
    this.render();
    this.onChange(next);
  }

  setPlaying(playing: boolean): void {
    this.playing = playing;
    this.playButton.textContent = playing ? 'Pause' : 'Play';
  }

  setDeep(deep: boolean): void {
    if (deep === this.deep) return;
    this.deep = deep;
    this.deepToggle.checked = deep;
    this.slider.min = String(this.minYears);
    this.slider.max = String(this.maxYears);
    this.slider.step = deep ? String(1000 * DEEP_RATE_SCALE) : '1000';
    for (const option of Array.from(this.rateSelect.options)) {
      option.textContent = this.rateLabel(option.value);
    }
    const clamped = this.clamp(this.years);
    if (clamped !== this.years) {
      this.years = clamped;
      this.onChange(clamped);
    }
    this.onDeepChange(deep);
    if (this.stats) this.applyDisclosure(this.stats);
    this.render();
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
    this.setYears(this.years + this.rate * (this.deep ? DEEP_RATE_SCALE : 1) * dt);
    if (this.years >= this.maxYears || this.years <= this.minYears) this.setPlaying(false);
  }

  setStats(stats: TimeStats): void {
    this.stats = stats;
    this.applyDisclosure(stats);
  }

  dispose(): void {
    this.element.remove();
  }

  private clamp(years: number): number {
    if (Number.isNaN(years)) return 0;
    return this.deep
      ? Math.min(Math.max(years, DEEP_MIN_YEARS), DEEP_MAX_YEARS)
      : clampYears(years);
  }

  private rateLabel(value: string): string {
    const rate = Number.parseFloat(value) * (this.deep ? DEEP_RATE_SCALE : 1);
    return rate >= 1e6 ? `${rate / 1e6} Myr/s` : `${rate / 1000}k yr/s`;
  }

  private applyDisclosure(stats: TimeStats): void {
    const text = this.deep ? deepTimeDisclosure(stats) : timeDisclosure(stats);
    if (text === this.disclosureText) return;
    this.disclosureText = text;
    this.disclosure.textContent = text;
  }

  private render(): void {
    this.slider.value = String(this.years);
    this.readout.textContent = this.deep ? formatDeepYears(this.years) : formatYears(this.years);
    this.disclosure.hidden = this.years === 0;
  }
}
