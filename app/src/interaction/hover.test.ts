import { describe, expect, it } from 'vitest';
import {
  CLASS_GALAXY,
  CLASS_PLANET,
  CLASS_STAR,
  FLAG_MODELED,
  FLAG_NOMINAL_MAGNITUDE,
  FLAG_NO_RADIAL_VELOCITY,
} from '../render/typeFlags.js';
import { decodeFloat16, type DecodedTile } from '../tiles/format.js';
import {
  circularSpeed,
  orbitPosition,
  PC_PER_MYR_PER_KMS,
  R0_PC,
  SOLAR_MOTION_KMS,
  toGalactocentric,
  toGalactocentricVelocity,
  Z_SUN_PC,
} from '../render/galacticOrbit.js';
import { DEEP_MODEL_HUBBLE, DEEP_MODEL_LINEAR, DEEP_MODEL_ORBIT } from '../render/pointMaterial.js';
import { distanceAtTime, hoverCardText, type DeepTimeState } from './hover.js';

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

// float16 bits for 100 km/s; asserted below so the fixture cannot drift.
const HALF_100 = 22080;
// 100 km/s for 1000 years is 3.15576e15 m, and a light year is 9.4607304725808e15 m.
const DRIFT_LY = 0.3335640951981521;

function tileWith(x: number, velocityBits: number, axis: 0 | 1 = 0): DecodedTile {
  const velocity = new Uint16Array(3);
  velocity[axis] = velocityBits;
  // The box spans the whole quantised range, so a stored value is its own coordinate.
  return {
    pointCount: 1,
    bboxMin: new Float64Array([0, 0, 0]),
    bboxMax: new Float64Array([65535, 65535, 65535]),
    positionQuantized: new Uint16Array([x, 0, 0]),
    velocity,
    colorIndex: new Uint16Array([0]),
    absMag: new Uint16Array([0]),
    typeFlags: new Uint8Array([CLASS_STAR]),
    localId: new Uint32Array([0]),
  };
}

const LY_PER_YEAR_PER_KMS = 3.3356409519815205e-6;

describe('distanceAtTime', () => {
  it('reads the fixture velocity as 100 km/s', () => {
    expect(decodeFloat16(HALF_100)).toBe(100);
  });

  it('reports the present-day distance at present day', () => {
    expect(distanceAtTime(tileWith(10, HALF_100), 0, 0, LY_PER_YEAR_PER_KMS)).toBeCloseTo(10, 12);
  });

  it('moves the point by its measured velocity', () => {
    const distance = distanceAtTime(tileWith(10, HALF_100), 0, 1000, LY_PER_YEAR_PER_KMS);
    expect(distance).toBeCloseTo(10 + DRIFT_LY, 9);
  });

  it('runs the clock backwards as well as forwards', () => {
    const distance = distanceAtTime(tileWith(10, HALF_100), 0, -1000, LY_PER_YEAR_PER_KMS);
    expect(distance).toBeCloseTo(10 - DRIFT_LY, 9);
  });

  it('adds drift as a vector, not to the distance', () => {
    // Sideways motion barely changes the range: 10 ly out with the drift at a
    // right angle gives hypot(10, 0.3336) = 10.00556, where adding the drift to
    // the distance would give 10.3336.
    const distance = distanceAtTime(tileWith(10, HALF_100, 1), 0, 1000, LY_PER_YEAR_PER_KMS);
    expect(distance).toBeCloseTo(Math.hypot(10, DRIFT_LY), 12);
    expect(distance).toBeLessThan(10.006);
  });

  it('leaves a zero-velocity point exactly where it is', () => {
    expect(distanceAtTime(tileWith(10, 0), 0, 1_000_000, LY_PER_YEAR_PER_KMS)).toBe(10);
  });
});


const PC_PER_LY = 9.4607304725808e15 / 3.0856775814913673e16;
const T_200_MYR = 2e8;

const orbitState: DeepTimeState = {
  model: DEEP_MODEL_ORBIT,
  layerParsecsPerUnit: PC_PER_LY,
  solarMotionKms: SOLAR_MOTION_KMS,
};

function heliocentricLy(galactocentricPc: readonly [number, number, number]): number {
  return (
    Math.hypot(galactocentricPc[0] + R0_PC, galactocentricPc[1], galactocentricPc[2] - Z_SUN_PC) /
    PC_PER_LY
  );
}

describe('distanceAtTime under deep time', () => {
  it('stays on the linear model when deep time is off or the layer is linear', () => {
    const tile = tileWith(10, HALF_100);
    const linear = distanceAtTime(tile, 0, T_200_MYR, LY_PER_YEAR_PER_KMS);
    expect(distanceAtTime(tile, 0, T_200_MYR, LY_PER_YEAR_PER_KMS, undefined)).toBe(linear);
    expect(
      distanceAtTime(tile, 0, T_200_MYR, LY_PER_YEAR_PER_KMS, {
        ...orbitState,
        model: DEEP_MODEL_LINEAR,
      }),
    ).toBe(linear);
  });

  it('follows the galactic orbit instead of extrapolating the velocity', () => {
    const expected = heliocentricLy(
      orbitPosition(
        toGalactocentric([10 * PC_PER_LY, 0, 0]),
        toGalactocentricVelocity([100, 0, 0]),
        T_200_MYR,
      ),
    );
    const distance = distanceAtTime(
      tileWith(10, HALF_100),
      0,
      T_200_MYR,
      LY_PER_YEAR_PER_KMS,
      orbitState,
    );
    expect(distance).toBeCloseTo(expected, 9);
  });

  it('diverges from the linear model by tens of thousands of light years at 200 Myr', () => {
    const tile = tileWith(10, HALF_100);
    const linear = distanceAtTime(tile, 0, T_200_MYR, LY_PER_YEAR_PER_KMS);
    const orbit = distanceAtTime(tile, 0, T_200_MYR, LY_PER_YEAR_PER_KMS, orbitState);
    expect(linear).toBeCloseTo(66722.8, 1);
    expect(orbit).toBeCloseTo(9695.5, 1);
    expect(Math.abs(orbit - linear)).toBeGreaterThan(50000);
  });

  it('carries a modeled point on the circular orbit its radius implies', () => {
    const tile = tileWith(10, 0);
    tile.typeFlags[0] = CLASS_STAR | FLAG_MODELED;
    const radiusPc = R0_PC - 10 * PC_PER_LY;
    const periodYears =
      ((2 * Math.PI * radiusPc) / (circularSpeed(radiusPc) * PC_PER_MYR_PER_KMS)) * 1e6;

    expect(distanceAtTime(tile, 0, periodYears, LY_PER_YEAR_PER_KMS)).toBe(10);
    // Half a turn puts it on the far side of the Galaxy, a full turn back home.
    expect(
      distanceAtTime(tile, 0, periodYears / 2, LY_PER_YEAR_PER_KMS, orbitState),
    ).toBeCloseTo((2 * R0_PC - 10 * PC_PER_LY) / PC_PER_LY, 3);
    expect(distanceAtTime(tile, 0, periodYears, LY_PER_YEAR_PER_KMS, orbitState)).toBeCloseTo(
      10,
      6,
    );
  });

  it('stretches an extragalactic point with the Hubble flow', () => {
    const hubble: DeepTimeState = { ...orbitState, model: DEEP_MODEL_HUBBLE };
    expect(distanceAtTime(tileWith(10, 0), 0, 13.97e9, LY_PER_YEAR_PER_KMS, hubble)).toBeCloseTo(
      20,
      9,
    );
  });
});
