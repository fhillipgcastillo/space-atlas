// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  createControlPanel,
  formatKnob,
  fromSliderPosition,
  SLIDER_STEPS,
  toSliderPosition,
  type ControlPanelDeps,
  type LayerKnobs,
  type ViewerKnobs,
} from './controlPanel.js';

const logRange = { min: 1, max: 1e5, scale: 'log' as const };
const linearRange = { min: 0, max: 8, scale: 'linear' as const };

describe('slider mapping', () => {
  it('maps both endpoints exactly on a log scale', () => {
    expect(fromSliderPosition(0, logRange)).toBe(logRange.min);
    expect(fromSliderPosition(SLIDER_STEPS, logRange)).toBe(logRange.max);
  });

  it('puts the geometric midpoint at the middle of the travel', () => {
    expect(fromSliderPosition(SLIDER_STEPS / 2, logRange)).toBeCloseTo(Math.sqrt(1e5), 6);
  });

  it('round-trips a value to within one slider step', () => {
    // 1000 integer steps over five decades: one step is a factor of 10^0.005.
    const step = Math.pow(10, 5 / SLIDER_STEPS);
    const returned = fromSliderPosition(toSliderPosition(800, logRange), logRange);
    expect(returned / 800).toBeGreaterThan(1 / step);
    expect(returned / 800).toBeLessThan(step);
  });

  it('spends half the travel below 1000 on a log scale and 1% on a linear one', () => {
    expect(toSliderPosition(1000, logRange)).toBe(600);
    expect(toSliderPosition(1000, { min: 1, max: 1e5, scale: 'linear' })).toBe(10);
  });

  it('clamps a value outside the range to an endpoint', () => {
    expect(toSliderPosition(-5, linearRange)).toBe(0);
    expect(toSliderPosition(500, linearRange)).toBe(SLIDER_STEPS);
  });

  it('maps a linear range proportionally', () => {
    expect(fromSliderPosition(250, linearRange)).toBeCloseTo(2, 6);
  });
});

describe('formatKnob', () => {
  it('drops decimals on large values and keeps them on small ones', () => {
    expect(formatKnob(800)).toBe('800');
    expect(formatKnob(0.45)).toBe('0.450');
    expect(formatKnob(1.5)).toBe('1.50');
  });
});

function makeViewer(): ViewerKnobs & { state: Record<string, number | boolean> } {
  const state: Record<string, number | boolean> = {
    alphaScale: 800,
    sizeScale: 500,
    minSize: 1,
    maxSize: 8,
    bloomEnabled: true,
    bloomStrength: 0.8,
    bloomRadius: 0.4,
    bloomThreshold: 0.9,
    exposure: 1,
    autoExposure: true,
  };
  return {
    state,
    getAlphaScale: () => state['alphaScale'] as number,
    setAlphaScale: (v) => void (state['alphaScale'] = v),
    getSizeScale: () => state['sizeScale'] as number,
    setSizeScale: (v) => void (state['sizeScale'] = v),
    getMinSize: () => state['minSize'] as number,
    setMinSize: (v) => void (state['minSize'] = v),
    getMaxSize: () => state['maxSize'] as number,
    setMaxSize: (v) => void (state['maxSize'] = v),
    getBloomEnabled: () => state['bloomEnabled'] as boolean,
    setBloomEnabled: (v) => void (state['bloomEnabled'] = v),
    getBloomStrength: () => state['bloomStrength'] as number,
    setBloomStrength: (v) => void (state['bloomStrength'] = v),
    getBloomRadius: () => state['bloomRadius'] as number,
    setBloomRadius: (v) => void (state['bloomRadius'] = v),
    getBloomThreshold: () => state['bloomThreshold'] as number,
    setBloomThreshold: (v) => void (state['bloomThreshold'] = v),
    getExposure: () => state['exposure'] as number,
    setExposure: (v) => void (state['exposure'] = v),
    getAutoExposure: () => state['autoExposure'] as boolean,
    setAutoExposure: (v) => void (state['autoExposure'] = v),
  };
}

function makeLayer(): LayerKnobs & { manager: { maxVisibleNodes: number; sse: number } } {
  const manager = {
    maxVisibleNodes: 199,
    sse: 1,
    gpuByteBudget: 512 * 1024 * 1024,
    getMaxVisibleNodes: () => manager.maxVisibleNodes,
    setMaxVisibleNodes: (v: number) => void (manager.maxVisibleNodes = v),
    getScreenSpaceErrorThreshold: () => manager.sse,
    setScreenSpaceErrorThreshold: (v: number) => void (manager.sse = v),
  };
  let modeledDim = 0.45;
  let showModeled = true;
  return {
    manager,
    getModeledDim: () => modeledDim,
    setModeledDim: (v) => void (modeledDim = v),
    getShowModeled: () => showModeled,
    setShowModeled: (v) => void (showModeled = v),
  };
}

function makeLabels(): { isVisible(): boolean; setVisible(v: boolean): void } {
  let visible = true;
  return { isVisible: () => visible, setVisible: (v) => void (visible = v) };
}

function setup(overrides: Partial<ControlPanelDeps> = {}) {
  const viewer = makeViewer();
  const layers = [makeLayer(), makeLayer()];
  const labels = makeLabels();
  const other = document.createElement('div');
  other.style.display = 'flex';
  document.body.appendChild(other);
  const panel = createControlPanel(document.body, {
    viewer,
    layers,
    labels,
    chrome: [other],
    ...overrides,
  });
  return { panel, viewer, layers, labels, other };
}

const control = (testId: string): HTMLInputElement =>
  document.querySelector<HTMLInputElement>(`[data-testid="control-${testId}"]`)!;

const readout = (testId: string): string =>
  document.querySelector(`[data-testid="control-${testId}-value"]`)!.textContent ?? '';

const drag = (input: HTMLInputElement, position: number): void => {
  input.value = String(position);
  input.dispatchEvent(new Event('input', { bubbles: true }));
};

describe('control panel', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('reads current values from the sources rather than the defaults', () => {
    const viewer = makeViewer();
    viewer.state['alphaScale'] = 400;
    viewer.state['bloomEnabled'] = false;
    const layer = makeLayer();
    layer.manager.maxVisibleNodes = 64;
    createControlPanel(document.body, { viewer, layers: [layer], labels: makeLabels() });

    expect(readout('alpha-scale')).toBe('400');
    expect(control('bloom-enabled').checked).toBe(false);
    expect(readout('max-visible-nodes')).toBe('64');
  });

  it('reaches the setter when a slider moves', () => {
    const { viewer } = setup();
    drag(control('alpha-scale'), SLIDER_STEPS);
    expect(viewer.state['alphaScale']).toBe(1e5);
    expect(readout('alpha-scale')).toBe('100,000');

    drag(control('bloom-strength'), 0);
    expect(viewer.state['bloomStrength']).toBe(0);
  });

  it('writes a population knob to every layer as an integer', () => {
    const { layers } = setup();
    drag(control('max-visible-nodes'), 0);
    expect(layers.map((l) => l.manager.maxVisibleNodes)).toEqual([4, 4]);
    expect(Number.isInteger(layers[0]!.manager.maxVisibleNodes)).toBe(true);
  });

  it('toggles labels through the label layer', () => {
    const { labels } = setup();
    const checkbox = control('show-labels');
    expect(checkbox.checked).toBe(true);
    checkbox.checked = false;
    checkbox.dispatchEvent(new Event('change'));
    expect(labels.isVisible()).toBe(false);
  });

  it('disables the exposure slider while auto exposure drives it', () => {
    const { viewer } = setup();
    expect(control('exposure').disabled).toBe(true);
    const auto = control('auto-exposure');
    auto.checked = false;
    auto.dispatchEvent(new Event('change'));
    expect(viewer.state['autoExposure']).toBe(false);
    expect(control('exposure').disabled).toBe(false);
  });

  it('re-reads the sources on sync', () => {
    const { panel, viewer } = setup();
    viewer.state['alphaScale'] = 12;
    panel.sync();
    expect(readout('alpha-scale')).toBe('12.00');
  });

  it('collapses the body without losing control state', () => {
    const { panel, viewer } = setup();
    drag(control('alpha-scale'), 0);
    panel.setCollapsed(true);
    expect(document.querySelector<HTMLElement>('[data-testid="control-panel-body"]')!.hidden).toBe(
      true,
    );
    panel.setCollapsed(false);
    expect(control('alpha-scale').value).toBe('0');
    expect(viewer.state['alphaScale']).toBe(1);
  });

  it('hides the panel, the supplied chrome and the labels, then restores them', () => {
    const { panel, labels, other } = setup();
    panel.hamburger.dispatchEvent(new MouseEvent('click'));

    expect(panel.isChromeVisible()).toBe(false);
    expect(panel.element.style.display).toBe('none');
    expect(other.style.display).toBe('none');
    expect(labels.isVisible()).toBe(false);
    expect(panel.hamburger.style.display).not.toBe('none');
    expect(panel.hamburger.isConnected).toBe(true);

    panel.hamburger.dispatchEvent(new MouseEvent('click'));
    expect(other.style.display).toBe('flex');
    expect(panel.element.style.display).toBe('');
    expect(labels.isVisible()).toBe(true);
  });

  it('restores labels to the state they were hidden in, not to visible', () => {
    const { panel, labels } = setup();
    const checkbox = control('show-labels');
    checkbox.checked = false;
    checkbox.dispatchEvent(new Event('change'));

    panel.setChromeVisible(false);
    panel.setChromeVisible(true);

    expect(labels.isVisible()).toBe(false);
    expect(control('show-labels').checked).toBe(false);
  });

  it('toggles the chrome on the shortcut key but not while an input has focus', () => {
    const { panel } = setup();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(panel.isChromeVisible()).toBe(false);

    const search = document.createElement('input');
    document.body.appendChild(search);
    search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(panel.isChromeVisible()).toBe(false);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(panel.isChromeVisible()).toBe(true);
  });

  it('stops listening after dispose', () => {
    const { panel } = setup();
    panel.dispose();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(panel.isChromeVisible()).toBe(true);
    expect(document.querySelector('[data-testid="control-panel"]')).toBeNull();
    expect(document.querySelector('[data-testid="chrome-toggle"]')).toBeNull();
  });
});
