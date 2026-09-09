import { describe, expect, it } from 'vitest';
import {
  CLASS_GALAXY,
  CLASS_PLANET,
  CLASS_STAR,
  FLAG_MODELED,
  FLAG_NOMINAL_MAGNITUDE,
  FLAG_NO_RADIAL_VELOCITY,
} from '../render/typeFlags.js';
import { hoverCardText } from './hover.js';

const base = {
  label: undefined as string | undefined,
  flags: CLASS_STAR,
  distance: 12.5,
  unit: 'ly',
  origin: 'Sol',
  absMag: 4.83,
  speed: 21.4,
};

describe('hoverCardText', () => {
  it('names the object when a label is known', () => {
    expect(hoverCardText({ ...base, label: 'Gaia DR3 12345' })).toContain('Gaia DR3 12345');
  });

  it('falls back to the object class rather than assuming a star', () => {
    const lines = hoverCardText({ ...base, flags: CLASS_GALAXY }).split('\n');
    expect(lines[0]).toBe('Galaxy');
  });

  it('does not repeat the class when it is already the label', () => {
    const lines = hoverCardText({ ...base, flags: CLASS_GALAXY }).split('\n');
    expect(lines.filter((l) => l === 'Galaxy')).toHaveLength(1);
  });

  it('shows the class beneath a known label', () => {
    const lines = hoverCardText({ ...base, label: 'Jupiter', flags: CLASS_PLANET }).split('\n');
    expect(lines[0]).toBe('Jupiter');
    expect(lines[1]).toBe('Planet');
  });

  it('measures distance from the active layer origin, not always Earth', () => {
    expect(hoverCardText({ ...base, unit: 'AU', origin: 'Sun' })).toContain('12.50 AU from Sun');
    expect(hoverCardText({ ...base, unit: 'Mly', origin: 'Milky Way' })).toContain(
      '12.50 Mly from Milky Way',
    );
  });

  it('marks a nominal magnitude so it cannot be read as measured', () => {
    expect(hoverCardText({ ...base, flags: CLASS_PLANET | FLAG_NOMINAL_MAGNITUDE })).toContain(
      '(nominal)',
    );
    expect(hoverCardText(base)).not.toContain('(nominal)');
  });

  it('marks a velocity with no measured radial component', () => {
    expect(hoverCardText({ ...base, flags: CLASS_STAR | FLAG_NO_RADIAL_VELOCITY })).toContain(
      'transverse only',
    );
    expect(hoverCardText(base)).not.toContain('transverse only');
  });

  it('marks a modeled object', () => {
    expect(hoverCardText({ ...base, flags: CLASS_STAR | FLAG_MODELED })).toContain('(modeled)');
  });

  it('reports every field it promises', () => {
    const lines = hoverCardText({ ...base, label: 'PGC 42', flags: CLASS_GALAXY }).split('\n');
    expect(lines).toHaveLength(5);
    expect(lines[2]).toContain('from Sol');
    expect(lines[3]).toContain('absolute magnitude');
    expect(lines[4]).toContain('km/s');
  });
});
