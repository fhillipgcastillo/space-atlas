import { describe, expect, it } from 'vitest';
import {
  angularMomentumZ,
  circularSpeed,
  epicyclicFrequency,
  GALACTIC_YEAR_MYR,
  integrateOrbit,
  MIN_CIRCULAR_SPEED_KMS,
  NU_KMS_PER_PC,
  orbitPosition,
  PC_PER_MYR_PER_KMS,
  R0_PC,
  SOLAR_MOTION_KMS,
  specificEnergy,
  toGalactocentric,
  toGalactocentricVelocity,
  V_CIRC_KMS,
  Z_SUN_PC,
  type Vec3,
} from './galacticOrbit.js';

const norm = (v: Vec3): number => Math.hypot(v[0], v[1], v[2]);
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (v: Vec3, k: number): Vec3 => [v[0] * k, v[1] * k, v[2] * k];
const radius = (p: Vec3): number => Math.hypot(p[0], p[1]);

const SUN_P = toGalactocentric([0, 0, 0]);
const SUN_V = toGalactocentricVelocity([0, 0, 0]);

// A disk star 150 pc from the Sun, in the direction (4, 3, 1).
const STAR_P = toGalactocentric(scale([4, 3, 1], 150 / Math.sqrt(26)));
const STAR_R = radius(STAR_P);
const ROTATION_UNIT: Vec3 = [STAR_P[1] / STAR_R, -STAR_P[0] / STAR_R, 0];

function diskStarVelocity(peculiarDirection: Vec3): Vec3 {
  const circular = scale(ROTATION_UNIT, circularSpeed(STAR_R));
  return add(circular, scale(peculiarDirection, 17));
}

const LAGGING_STAR_V = diskStarVelocity(scale(ROTATION_UNIT, -1));
const NEAR_CIRCULAR_STAR_V = diskStarVelocity(scale(ROTATION_UNIT, -2 / 17));

function epicyclicErrorFraction(v: Vec3, years: number): number {
  const exact = integrateOrbit(STAR_P, v, years, 20_000).position;
  const closed = orbitPosition(STAR_P, v, years);
  return norm(sub(closed, exact)) / STAR_R;
}

function peculiarDirections(): Vec3[] {
  const directions: Vec3[] = [];
  for (let i = 0; i < 8; i += 1) {
    const angle = (i * Math.PI) / 4;
    directions.push([Math.cos(angle), Math.sin(angle), 0]);
  }
  directions.push([0, 0, 1], [0.577, 0.577, 0.577], [-0.577, 0.577, 0.577]);
  return directions;
}

describe('orbitPosition against integrateOrbit', () => {
  it('stays under 3% of R at 100 Myr and 6% at 250 Myr for every peculiar direction', () => {
    let worst100 = 0;
    let worst250 = 0;
    for (const direction of peculiarDirections()) {
      const v = diskStarVelocity(direction);
      worst100 = Math.max(worst100, epicyclicErrorFraction(v, 100e6));
      worst250 = Math.max(worst250, epicyclicErrorFraction(v, 250e6));
    }
    expect(worst100).toBeLessThan(0.03);
    expect(worst250).toBeLessThan(0.06);
    expect(worst100).toBeGreaterThan(0);
  });

  it('reproduces the measured 2.6% at 100 Myr and 5.4% at 250 Myr for a lagging disk star', () => {
    expect(100 * epicyclicErrorFraction(LAGGING_STAR_V, 100e6)).toBeCloseTo(2.6, 0);
    expect(100 * epicyclicErrorFraction(LAGGING_STAR_V, 250e6)).toBeCloseTo(5.4, 0);
  });

  it('reproduces the linear model error of 1.4% of the distance travelled at 1 Myr', () => {
    const years = 1e6;
    const exact = integrateOrbit(STAR_P, LAGGING_STAR_V, years, 20_000).position;
    const linear = add(STAR_P, scale(LAGGING_STAR_V, (PC_PER_MYR_PER_KMS * years) / 1e6));
    expect((100 * norm(sub(linear, exact))) / norm(sub(exact, STAR_P))).toBeCloseTo(1.4, 0);
  });

  it('overtakes the linear model by 10 Myr, but not yet at 1 Myr', () => {
    const compare = (years: number): { curved: number; linear: number } => {
      const exact = integrateOrbit(STAR_P, LAGGING_STAR_V, years, 20_000).position;
      const linear = add(STAR_P, scale(LAGGING_STAR_V, (PC_PER_MYR_PER_KMS * years) / 1e6));
      return {
        curved: norm(sub(orbitPosition(STAR_P, LAGGING_STAR_V, years), exact)),
        linear: norm(sub(linear, exact)),
      };
    };
    const near = compare(1e6);
    expect(near.curved).toBeGreaterThan(near.linear);
    const far = compare(10e6);
    expect(far.curved).toBeLessThan(far.linear / 5);
  });
});

describe('integrateOrbit', () => {
  it('is converged: quadrupling the steps moves the 250 Myr endpoint under 1e-6 pc', () => {
    const coarse = integrateOrbit(STAR_P, LAGGING_STAR_V, 250e6, 20_000).position;
    const fine = integrateOrbit(STAR_P, LAGGING_STAR_V, 250e6, 80_000).position;
    expect(norm(sub(coarse, fine))).toBeLessThan(1e-6);
  });

  it('conserves Lz and energy out to 1 Gyr', () => {
    const lz0 = angularMomentumZ(STAR_P, LAGGING_STAR_V);
    const e0 = specificEnergy(STAR_P, LAGGING_STAR_V);
    for (const years of [100e6, 250e6, 1000e6]) {
      const state = integrateOrbit(STAR_P, LAGGING_STAR_V, years, 20_000);
      const lz = angularMomentumZ(state.position, state.velocityKms);
      const energy = specificEnergy(state.position, state.velocityKms);
      expect(Math.abs(lz / lz0 - 1)).toBeLessThan(1e-10);
      expect(Math.abs(energy / e0 - 1)).toBeLessThan(1e-10);
    }
  });
});

describe('a circular orbit', () => {
  const p: Vec3 = [-R0_PC, 0, 0];
  const v: Vec3 = [0, V_CIRC_KMS, 0];

  it('holds its radius over a full galactic year', () => {
    for (let i = 0; i <= 40; i += 1) {
      const years = (i / 40) * GALACTIC_YEAR_MYR * 1e6;
      const q = orbitPosition(p, v, years);
      expect(radius(q) / R0_PC - 1).toBeCloseTo(0, 12);
      expect(Math.abs(q[2])).toBe(0);
    }
  });

  it('closes after exactly one galactic year', () => {
    const q = orbitPosition(p, v, GALACTIC_YEAR_MYR * 1e6);
    expect(norm(sub(q, p)) / R0_PC).toBeLessThan(1e-12);
  });
});

describe('the Sun', () => {
  it('has negative Lz in this frame', () => {
    expect(SUN_P).toEqual([-R0_PC, 0, Z_SUN_PC]);
    expect(angularMomentumZ(SUN_P, SUN_V)).toBeLessThan(0);
  });

  it('picks up the solar motion when its velocity is transformed', () => {
    expect(toGalactocentricVelocity([1, 2, 3])).toEqual([
      SOLAR_MOTION_KMS[0] + 1,
      SOLAR_MOTION_KMS[1] + 2,
      SOLAR_MOTION_KMS[2] + 3,
    ]);
  });

  it('comes back near its start after a galactic year', () => {
    const years = GALACTIC_YEAR_MYR * 1e6;
    const circumference = 2 * Math.PI * R0_PC;
    const closed = norm(sub(orbitPosition(SUN_P, SUN_V, years), SUN_P));
    const exact = norm(sub(integrateOrbit(SUN_P, SUN_V, years, 20_000).position, SUN_P));
    expect(closed / circumference).toBeLessThan(0.05);
    expect(exact / circumference).toBeLessThan(0.05);
  });
});

describe('the small-t limit', () => {
  const displacementPc = (v: Vec3, years: number): Vec3 =>
    scale(v, (PC_PER_MYR_PER_KMS * years) / 1e6);

  it('reduces to p0 + v t within 0.2% of the distance travelled at 0.1 Myr', () => {
    const years = 1e5;
    const v = NEAR_CIRCULAR_STAR_V;
    const displacement = displacementPc(v, years);
    const curved = orbitPosition(STAR_P, v, years);
    expect(norm(sub(curved, add(STAR_P, displacement))) / norm(displacement)).toBeLessThan(
      0.002,
    );
  });

  it('leaves the straight line only by the real curvature of the orbit', () => {
    const years = 1e5;
    const v = NEAR_CIRCULAR_STAR_V;
    const exact = integrateOrbit(STAR_P, v, years, 20_000).position;
    const linear = add(STAR_P, displacementPc(v, years));
    expect(norm(sub(orbitPosition(STAR_P, v, years), exact))).toBeLessThan(
      norm(sub(linear, exact)) / 4,
    );
  });

  it('moves a 150 pc star under 5 pc when the model switches at the Phase 4 boundary', () => {
    const years = 1e6;
    const linear = add(
      sub(STAR_P, SUN_P),
      displacementPc(sub(LAGGING_STAR_V, SOLAR_MOTION_KMS), years),
    );
    const curved = sub(
      orbitPosition(STAR_P, LAGGING_STAR_V, years),
      orbitPosition(SUN_P, SUN_V, years),
    );
    expect(norm(sub(curved, linear))).toBeLessThan(5);
  });
});

describe('the constants', () => {
  it('converts km/s to pc/Myr', () => {
    expect(PC_PER_MYR_PER_KMS).toBeCloseTo(1.0227121650537077, 9);
  });

  it('gives a 212.7 Myr galactic year at the Sun', () => {
    expect(GALACTIC_YEAR_MYR).toBeCloseTo(212.7, 1);
  });

  it('gives an 83.6 Myr vertical period from the Oort limit', () => {
    expect(NU_KMS_PER_PC * 1000).toBeCloseTo(73.5, 1);
    expect((2 * Math.PI) / (NU_KMS_PER_PC * PC_PER_MYR_PER_KMS)).toBeCloseTo(83.6, 1);
  });

  it('gives 40.85 km/s/kpc for kappa on a flat curve and 39.6 with the measured slope', () => {
    expect(Math.SQRT2 * (V_CIRC_KMS / R0_PC) * 1000).toBeCloseTo(40.85, 2);
    expect(epicyclicFrequency(R0_PC) * 1000).toBeCloseTo(39.6, 1);
  });

  it('keeps the extrapolated rotation curve positive', () => {
    expect(circularSpeed(R0_PC)).toBe(V_CIRC_KMS);
    expect(circularSpeed(4000)).toBeGreaterThan(V_CIRC_KMS);
    expect(circularSpeed(1e7)).toBe(MIN_CIRCULAR_SPEED_KMS);
  });

  it('places the Sun above the plane', () => {
    expect(Z_SUN_PC).toBe(20.8);
    expect(toGalactocentric([0, 0, 0])[2]).toBe(Z_SUN_PC);
  });
});
