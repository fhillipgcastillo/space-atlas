export interface ViewerKnobs {
  getAlphaScale(): number;
  setAlphaScale(value: number): void;
  getSizeScale(): number;
  setSizeScale(value: number): void;
  getMinSize(): number;
  setMinSize(value: number): void;
  getMaxSize(): number;
  setMaxSize(value: number): void;
  getBloomEnabled(): boolean;
  setBloomEnabled(enabled: boolean): void;
  getBloomStrength(): number;
  setBloomStrength(value: number): void;
  getBloomRadius(): number;
  setBloomRadius(value: number): void;
  getBloomThreshold(): number;
  setBloomThreshold(value: number): void;
  getExposure(): number;
  setExposure(value: number): void;
  getAutoExposure(): boolean;
  setAutoExposure(enabled: boolean): void;
}

export interface TileKnobs {
  readonly gpuByteBudget: number;
  getMaxVisibleNodes(): number;
  setMaxVisibleNodes(value: number): void;
  getScreenSpaceErrorThreshold(): number;
  setScreenSpaceErrorThreshold(value: number): void;
}

export interface LayerKnobs {
  readonly manager: TileKnobs;
  getModeledDim(): number;
  setModeledDim(value: number): void;
  getShowModeled(): boolean;
  setShowModeled(show: boolean): void;
}

export interface LabelKnobs {
  isVisible(): boolean;
  setVisible(visible: boolean): void;
}

export interface StatsKnobs {
  isVisible(): boolean;
  setVisible(visible: boolean): void;
}

export interface ControlPanelDeps {
  viewer: ViewerKnobs;
  /** Every layer renderer: a knob writes to all of them and reads the first. */
  layers: readonly LayerKnobs[];
  labels: LabelKnobs;
  stats?: StatsKnobs;
  /** Other UI roots the chrome toggle hides. The canvas must not be among them. */
  chrome?: readonly HTMLElement[];
  /** KeyboardEvent.key that toggles the chrome; null disables the shortcut. */
  toggleKey?: string | null;
}

export type SliderScale = 'linear' | 'log';

export interface SliderRange {
  min: number;
  max: number;
  scale: SliderScale;
}

export const SLIDER_STEPS = 1000;

export function toSliderPosition(value: number, range: SliderRange): number {
  const clamped = Math.min(Math.max(value, range.min), range.max);
  const fraction =
    range.scale === 'log'
      ? Math.log(clamped / range.min) / Math.log(range.max / range.min)
      : (clamped - range.min) / (range.max - range.min);
  return Math.round(fraction * SLIDER_STEPS);
}

export function fromSliderPosition(position: number, range: SliderRange): number {
  // Exact endpoints rather than min*(max/min)^1, which floating point misses.
  if (position <= 0) return range.min;
  if (position >= SLIDER_STEPS) return range.max;
  const fraction = position / SLIDER_STEPS;
  return range.scale === 'log'
    ? range.min * Math.pow(range.max / range.min, fraction)
    : range.min + fraction * (range.max - range.min);
}

export function formatKnob(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const magnitude = Math.abs(value);
  if (magnitude >= 100) return value.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (magnitude >= 1) return value.toFixed(2);
  return value.toFixed(3);
}

interface SliderSpec extends SliderRange {
  label: string;
  testId: string;
  integer?: boolean;
  get(): number;
  set(value: number): void;
}

interface ToggleSpec {
  label: string;
  testId: string;
  get(): boolean;
  set(on: boolean): void;
}

interface Control {
  sync(): void;
}

const PANEL_CSS = [
  'position:fixed',
  'left:12px',
  // Below the search box, which owns the top left corner.
  'top:52px',
  'width:236px',
  'max-height:calc(100vh - 140px)',
  'overflow-y:auto',
  'padding:8px 10px',
  'font:12px/1.6 ui-monospace,monospace',
  'color:#e8f1ff',
  'background:rgba(8,12,22,0.82)',
  'border:1px solid rgba(120,160,220,0.35)',
  'border-radius:4px',
  // Above the HUD panels at 25, below the search result list at 40.
  'z-index:26',
].join(';');

const BUTTON_CSS = [
  'font:inherit',
  'color:#e8f1ff',
  'background:#0d1422',
  'border:1px solid rgba(120,160,220,0.35)',
  'border-radius:3px',
  'padding:0 6px',
  'cursor:pointer',
].join(';');

// The right edge midway down: the four corners and the top strip are all taken
// by existing panels at narrow widths.
const HAMBURGER_CSS = [
  'position:fixed',
  'right:12px',
  'top:50%',
  'transform:translateY(-50%)',
  'width:30px',
  'height:26px',
  'font:14px/1 ui-monospace,monospace',
  'color:#e8f1ff',
  'background:rgba(8,12,22,0.82)',
  'border:1px solid rgba(120,160,220,0.35)',
  'border-radius:4px',
  'cursor:pointer',
  'z-index:60',
].join(';');

const GROUP_CSS = 'margin-top:8px;border-top:1px solid rgba(120,160,220,0.2);padding-top:4px';
const HINT_CSS = 'color:#9fb4d4';

export class ControlPanel {
  readonly element: HTMLDivElement;
  readonly hamburger: HTMLButtonElement;

  private readonly body: HTMLDivElement;
  private readonly collapseButton: HTMLButtonElement;
  private readonly controls: Control[] = [];
  private readonly hiddenDisplay = new Map<HTMLElement, string>();
  private readonly chrome: readonly HTMLElement[];
  private readonly toggleKey: string | null;
  private collapsed = false;
  private chromeVisible = true;
  private labelsWereVisible = true;
  private exposureControl?: { input: HTMLInputElement; control: Control };

  constructor(
    parent: HTMLElement,
    private readonly deps: ControlPanelDeps,
  ) {
    this.chrome = deps.chrome ?? [];
    this.toggleKey = deps.toggleKey === undefined ? 'Escape' : deps.toggleKey;

    this.element = document.createElement('div');
    this.element.setAttribute('data-testid', 'control-panel');
    this.element.style.cssText = PANEL_CSS;

    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:6px';
    const title = document.createElement('div');
    title.textContent = 'Controls';
    title.style.cssText = HINT_CSS;
    const collapseButton = document.createElement('button');
    collapseButton.type = 'button';
    collapseButton.setAttribute('data-testid', 'control-collapse');
    collapseButton.style.cssText = BUTTON_CSS;
    collapseButton.addEventListener('click', () => this.setCollapsed(!this.collapsed));
    header.append(title, collapseButton);
    this.collapseButton = collapseButton;

    this.body = document.createElement('div');
    this.body.setAttribute('data-testid', 'control-panel-body');
    this.element.append(header, this.body);

    this.buildPoints();
    this.buildBloom();
    this.buildExposure();
    this.buildPopulation();
    this.buildModeled();
    this.buildLabels();

    this.hamburger = document.createElement('button');
    this.hamburger.type = 'button';
    this.hamburger.textContent = '☰';
    this.hamburger.setAttribute('data-testid', 'chrome-toggle');
    this.hamburger.style.cssText = HAMBURGER_CSS;
    this.hamburger.addEventListener('click', () => this.setChromeVisible(!this.chromeVisible));

    parent.append(this.element, this.hamburger);
    window.addEventListener('keydown', this.onKeyDown);
    this.renderCollapse();
    this.renderChrome();
    this.sync();
  }

  /** Re-reads every source of truth. Values the app changes on its own go stale otherwise. */
  sync(): void {
    for (const control of this.controls) control.sync();
  }

  isCollapsed(): boolean {
    return this.collapsed;
  }

  setCollapsed(collapsed: boolean): void {
    this.collapsed = collapsed;
    if (!collapsed) this.sync();
    this.renderCollapse();
  }

  isChromeVisible(): boolean {
    return this.chromeVisible;
  }

  setChromeVisible(visible: boolean): void {
    if (visible === this.chromeVisible) return;
    this.chromeVisible = visible;
    if (!visible) this.labelsWereVisible = this.deps.labels.isVisible();
    this.renderChrome();
    if (visible) this.sync();
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    this.element.remove();
    this.hamburger.remove();
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (this.toggleKey === null || event.key !== this.toggleKey) return;
    if (isEditable(event.target)) return;
    this.setChromeVisible(!this.chromeVisible);
  };

  private renderCollapse(): void {
    this.body.hidden = this.collapsed;
    this.collapseButton.textContent = this.collapsed ? '+' : '−';
  }

  private renderChrome(): void {
    for (const element of [this.element, ...this.chrome]) {
      if (this.chromeVisible) this.restoreDisplay(element);
      else this.hideElement(element);
    }
    this.deps.labels.setVisible(this.chromeVisible ? this.labelsWereVisible : false);
    this.hamburger.setAttribute('aria-expanded', String(this.chromeVisible));
    this.hamburger.title = this.chromeVisible ? 'Hide the interface' : 'Show the interface';
  }

  // Only the inline display is touched, so each panel keeps its own state.
  private hideElement(element: HTMLElement): void {
    if (this.hiddenDisplay.has(element)) return;
    this.hiddenDisplay.set(element, element.style.display);
    element.style.display = 'none';
  }

  private restoreDisplay(element: HTMLElement): void {
    const previous = this.hiddenDisplay.get(element);
    if (previous === undefined) return;
    element.style.display = previous;
    this.hiddenDisplay.delete(element);
  }

  private buildPoints(): void {
    const viewer = this.deps.viewer;
    const group = this.group('Points');
    this.slider(group, {
      label: 'Alpha scale',
      testId: 'alpha-scale',
      min: 1,
      max: 1e5,
      scale: 'log',
      get: () => viewer.getAlphaScale(),
      set: (v) => viewer.setAlphaScale(v),
    });
    this.slider(group, {
      label: 'Size scale',
      testId: 'size-scale',
      min: 10,
      max: 5000,
      scale: 'log',
      get: () => viewer.getSizeScale(),
      set: (v) => viewer.setSizeScale(v),
    });
    this.slider(group, {
      label: 'Min point px',
      testId: 'min-size',
      min: 0,
      max: 8,
      scale: 'linear',
      get: () => viewer.getMinSize(),
      set: (v) => viewer.setMinSize(v),
    });
    this.slider(group, {
      label: 'Max point px',
      testId: 'max-size',
      min: 1,
      max: 64,
      scale: 'linear',
      get: () => viewer.getMaxSize(),
      set: (v) => viewer.setMaxSize(v),
    });
  }

  private buildBloom(): void {
    const viewer = this.deps.viewer;
    const group = this.group('Bloom');
    this.toggle(group, {
      label: 'Enabled',
      testId: 'bloom-enabled',
      get: () => viewer.getBloomEnabled(),
      set: (on) => viewer.setBloomEnabled(on),
    });
    this.slider(group, {
      label: 'Strength',
      testId: 'bloom-strength',
      min: 0,
      max: 3,
      scale: 'linear',
      get: () => viewer.getBloomStrength(),
      set: (v) => viewer.setBloomStrength(v),
    });
    this.slider(group, {
      label: 'Radius',
      testId: 'bloom-radius',
      min: 0,
      max: 1,
      scale: 'linear',
      get: () => viewer.getBloomRadius(),
      set: (v) => viewer.setBloomRadius(v),
    });
    this.slider(group, {
      label: 'Threshold',
      testId: 'bloom-threshold',
      min: 0,
      max: 1,
      scale: 'linear',
      get: () => viewer.getBloomThreshold(),
      set: (v) => viewer.setBloomThreshold(v),
    });
  }

  private buildExposure(): void {
    const viewer = this.deps.viewer;
    const group = this.group('Exposure');
    this.toggle(group, {
      label: 'Auto exposure',
      testId: 'auto-exposure',
      get: () => viewer.getAutoExposure(),
      set: (on) => {
        viewer.setAutoExposure(on);
        this.renderExposure();
      },
    });
    const exposure = this.slider(group, {
      label: 'Exposure',
      testId: 'exposure',
      min: 0.02,
      max: 20,
      scale: 'log',
      get: () => viewer.getExposure(),
      set: (v) => viewer.setExposure(v),
    });
    this.exposureControl = exposure;
    this.renderExposure();
  }

  // The auto loop rewrites exposure every frame, so a live slider would fight it.
  private renderExposure(): void {
    if (!this.exposureControl) return;
    this.exposureControl.control.sync();
    this.exposureControl.input.disabled = this.deps.viewer.getAutoExposure();
  }

  private buildPopulation(): void {
    const layers = this.deps.layers;
    const first = layers[0];
    const group = this.group('Population');
    if (first) {
      this.slider(group, {
        label: 'Max tiles / layer',
        testId: 'max-visible-nodes',
        min: 4,
        max: 2000,
        scale: 'log',
        integer: true,
        get: () => first.manager.getMaxVisibleNodes(),
        set: (v) => {
          for (const layer of layers) layer.manager.setMaxVisibleNodes(v);
        },
      });
      this.slider(group, {
        label: 'Detail threshold px',
        testId: 'sse-threshold',
        min: 0.1,
        max: 64,
        scale: 'log',
        get: () => first.manager.getScreenSpaceErrorThreshold(),
        set: (v) => {
          for (const layer of layers) layer.manager.setScreenSpaceErrorThreshold(v);
        },
      });
      const budget = document.createElement('div');
      budget.setAttribute('data-testid', 'gpu-budget');
      budget.style.cssText = HINT_CSS;
      const megabytes = Math.round(first.manager.gpuByteBudget / (1024 * 1024));
      budget.textContent = `GPU budget ${megabytes} MB · fixed at startup`;
      group.appendChild(budget);
    }
  }

  private buildModeled(): void {
    const layers = this.deps.layers;
    const first = layers[0];
    if (!first) return;
    const group = this.group('Modeled points');
    this.toggle(group, {
      label: 'Show modeled',
      testId: 'show-modeled',
      get: () => first.getShowModeled(),
      set: (on) => {
        for (const layer of layers) layer.setShowModeled(on);
      },
    });
    this.slider(group, {
      label: 'Modeled dim',
      testId: 'modeled-dim',
      min: 0,
      max: 1,
      scale: 'linear',
      get: () => first.getModeledDim(),
      set: (v) => {
        for (const layer of layers) layer.setModeledDim(v);
      },
    });
  }

  private buildLabels(): void {
    const group = this.group('Labels');
    this.toggle(group, {
      label: 'Show labels',
      testId: 'show-labels',
      get: () => this.deps.labels.isVisible(),
      set: (on) => {
        this.labelsWereVisible = on;
        this.deps.labels.setVisible(on);
      },
    });

    const stats = this.deps.stats;
    if (stats) {
      this.toggle(group, {
        label: 'Show stats',
        testId: 'show-stats',
        get: () => stats.isVisible(),
        set: (on) => stats.setVisible(on),
      });
    }
  }

  private group(name: string): HTMLDivElement {
    const group = document.createElement('div');
    group.style.cssText = GROUP_CSS;
    const title = document.createElement('div');
    title.textContent = name;
    title.style.cssText = HINT_CSS;
    group.appendChild(title);
    this.body.appendChild(group);
    return group;
  }

  private slider(
    group: HTMLDivElement,
    spec: SliderSpec,
  ): { input: HTMLInputElement; control: Control } {
    const row = document.createElement('label');
    row.style.cssText = 'display:block;cursor:pointer';

    const caption = document.createElement('div');
    caption.style.cssText = 'display:flex;justify-content:space-between;gap:6px';
    const label = document.createElement('span');
    label.textContent = spec.label;
    const readout = document.createElement('span');
    readout.setAttribute('data-testid', `control-${spec.testId}-value`);
    readout.style.cssText = 'color:#ffffff';
    caption.append(label, readout);

    const input = document.createElement('input');
    input.type = 'range';
    input.min = '0';
    input.max = String(SLIDER_STEPS);
    input.step = '1';
    input.setAttribute('data-testid', `control-${spec.testId}`);
    input.style.cssText = 'width:100%;margin:0;accent-color:#7aa6e0';

    const control: Control = {
      sync: () => {
        const value = spec.get();
        input.value = String(toSliderPosition(value, spec));
        readout.textContent = spec.integer ? String(Math.round(value)) : formatKnob(value);
      },
    };

    input.addEventListener('input', () => {
      const raw = fromSliderPosition(Number(input.value), spec);
      const value = spec.integer ? Math.round(raw) : raw;
      spec.set(value);
      readout.textContent = spec.integer ? String(value) : formatKnob(value);
    });

    row.append(caption, input);
    group.appendChild(row);
    this.controls.push(control);
    return { input, control };
  }

  private toggle(group: HTMLDivElement, spec: ToggleSpec): HTMLInputElement {
    const row = document.createElement('label');
    row.style.cssText = 'display:block;cursor:pointer';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.setAttribute('data-testid', `control-${spec.testId}`);
    input.addEventListener('change', () => spec.set(input.checked));
    row.append(input, document.createTextNode(` ${spec.label}`));
    group.appendChild(row);
    this.controls.push({ sync: () => (input.checked = spec.get()) });
    return input;
  }
}

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

export function createControlPanel(parent: HTMLElement, deps: ControlPanelDeps): ControlPanel {
  return new ControlPanel(parent, deps);
}
