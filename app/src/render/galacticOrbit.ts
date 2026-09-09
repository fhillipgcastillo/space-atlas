// Closed-form epicyclic orbits in an axisymmetric galactic potential, plus an
// RK4 integrator in the same potential to check them against.

export type Vec3 = readonly [number, number, number];

// GRAVITY Collaboration 2021, the Sgr A* orbit distance.
export const R0_PC = 8122;

// 4.74047 * 6.411 mas/yr * 8.122 kpc: fixed by the Sgr A* proper motion, not a free parameter.
export const V_SUN_TOTAL_KMS = 246.84;

// V_SUN_TOTAL minus Schoenrich's 12.24 km/s solar peculiar V.
export const V_CIRC_KMS = 234.6;

// Schoenrich U and W with the V above, in the galactic basis.
export const SOLAR_MOTION_KMS: Vec3 = [11.1, V_SUN_TOTAL_KMS, 7.25];

// Bennett & Bovy 2019.
export const Z_SUN_PC = 20.8;

// Eilers 2019 rotation-curve slope, -1.7 km/s/kpc.
export const CURVE_SLOPE_KMS_PER_PC = -0.0017;

// Guard on the extrapolated curve; the linear fit runs negative far outside its fitted range.
export const MIN_CIRCULAR_SPEED_KMS = 20;

const SECONDS_PER_YEAR = 31_557_600;
const METRES_PER_PC = 3.085_677_581_491_367_3e16;
export const PC_PER_MYR_PER_KMS = (1000 * SECONDS_PER_YEAR * 1e6) / METRES_PER_PC;

// G in pc (km/s)^2 / Msun.
const G_PC_KMS2_PER_MSUN = 4.300_917_270e-3;

// Oort limit local mass density, Msun/pc^3.
const RHO0_MSUN_PER_PC3 = 0.1;

/** Vertical oscillation frequency, sqrt(4 pi G rho0), in km/s per pc. */
export const NU_KMS_PER_PC = Math.sqrt(4 * Math.PI * G_PC_KMS2_PER_MSUN * RHO0_MSUN_PER_PC3);

export const GALACTIC_YEAR_MYR = (2 * Math.PI * R0_PC) / (V_CIRC_KMS * PC_PER_MYR_PER_KMS);

const CURVE_SLOPE = CURVE_SLOPE_KMS_PER_PC * PC_PER_MYR_PER_KMS;
const CURVE_INTERCEPT = (V_CIRC_KMS - CURVE_SLOPE_KMS_PER_PC * R0_PC) * PC_PER_MYR_PER_KMS;
const MIN_SPEED = MIN_CIRCULAR_SPEED_KMS * PC_PER_MYR_PER_KMS;
const FLOOR_RADIUS_PC = (MIN_SPEED - CURVE_INTERCEPT) / CURVE_SLOPE;
const NU = NU_KMS_PER_PC * PC_PER_MYR_PER_KMS;

export function toGalactocentric(heliocentricPc: Vec3): Vec3 {
  return [heliocentricPc[0] - R0_PC, heliocentricPc[1], heliocentricPc[2] + Z_SUN_PC];
}

export function toGalactocentricVelocity(heliocentricKms: Vec3): Vec3 {
  return [
    heliocentricKms[0] + SOLAR_MOTION_KMS[0],
    heliocentricKms[1] + SOLAR_MOTION_KMS[1],
    heliocentricKms[2] + SOLAR_MOTION_KMS[2],
  ];
}

export function circularSpeed(radiusPc: number): number {
  return Math.max(
    V_CIRC_KMS + CURVE_SLOPE_KMS_PER_PC * (radiusPc - R0_PC),
    MIN_CIRCULAR_SPEED_KMS,
  );
}

/** Epicyclic frequency sqrt(2 Omega (Omega + dv_c/dR)), in km/s per pc. */
export function epicyclicFrequency(radiusPc: number): number {
  const omega = circularSpeed(radiusPc) / radiusPc;
  const slope = radiusPc < FLOOR_RADIUS_PC ? CURVE_SLOPE_KMS_PER_PC : 0;
  return Math.sqrt(2 * omega * (omega + slope));
}

function circularSpeedPcMyr(radiusPc: number): number {
  return Math.max(CURVE_INTERCEPT + CURVE_SLOPE * radiusPc, MIN_SPEED);
}

/** Radius whose circular orbit carries |Lz|, by fixed-point iteration on a slowly varying curve. */
function guidingRadius(lzMagnitude: number): number {
  let radius = lzMagnitude / (V_CIRC_KMS * PC_PER_MYR_PER_KMS);
  for (let i = 0; i < 24; i += 1) {
    radius = lzMagnitude / circularSpeedPcMyr(radius);
  }
  return radius;
}

function toPcPerMyr(velocityKms: Vec3): Vec3 {
  return [
    velocityKms[0] * PC_PER_MYR_PER_KMS,
    velocityKms[1] * PC_PER_MYR_PER_KMS,
    velocityKms[2] * PC_PER_MYR_PER_KMS,
  ];
}

export function orbitPosition(p0: Vec3, v0Kms: Vec3, tYears: number): Vec3 {
  const t = tYears / 1e6;
  const [x0, y0, z0] = p0;
  const [vx, vy, vz] = toPcPerMyr(v0Kms);
  const r0 = Math.hypot(x0, y0);
  const lz = x0 * vy - y0 * vx;
  const rg = guidingRadius(Math.abs(lz));
  if (!(r0 > 0) || !(rg > 0)) {
    return [x0 + vx * t, y0 + vy * t, z0 + vz * t];
  }

  const vr0 = (x0 * vx + y0 * vy) / r0;
  const phi0 = Math.atan2(y0, x0);
  const kappa = epicyclicFrequency(rg) * PC_PER_MYR_PER_KMS;
  const omegaG = lz / (rg * rg);
  const amplitude = Math.hypot(r0 - rg, vr0 / kappa);
  const a0 = Math.atan2(-vr0 / kappa, r0 - rg);

  const phase = kappa * t + a0;
  const r = rg + amplitude * Math.cos(phase);
  const phi =
    phi0 +
    omegaG * t -
    ((2 * omegaG * amplitude) / (kappa * rg)) * (Math.sin(phase) - Math.sin(a0));
  const z = z0 * Math.cos(NU * t) + (vz / NU) * Math.sin(NU * t);
  return [r * Math.cos(phi), r * Math.sin(phi), z];
}

function acceleration(p: Vec3): Vec3 {
  const r = Math.hypot(p[0], p[1]);
  const vc = circularSpeedPcMyr(r);
  const radial = r > 0 ? -(vc * vc) / (r * r) : 0;
  return [radial * p[0], radial * p[1], -NU * NU * p[2]];
}

export interface OrbitState {
  position: Vec3;
  velocityKms: Vec3;
}

export function integrateOrbit(
  p0: Vec3,
  v0Kms: Vec3,
  tYears: number,
  steps: number,
): OrbitState {
  const dt = tYears / 1e6 / steps;
  let p = p0;
  let v = toPcPerMyr(v0Kms);
  const step = (a: Vec3, b: Vec3, h: number): Vec3 =>
    [a[0] + b[0] * h, a[1] + b[1] * h, a[2] + b[2] * h] as Vec3;

  for (let i = 0; i < steps; i += 1) {
    const k1v = acceleration(p);
    const p2 = step(p, v, dt / 2);
    const v2 = step(v, k1v, dt / 2);
    const k2v = acceleration(p2);
    const p3 = step(p, v2, dt / 2);
    const v3 = step(v, k2v, dt / 2);
    const k3v = acceleration(p3);
    const p4 = step(p, v3, dt);
    const v4 = step(v, k3v, dt);
    const k4v = acceleration(p4);
    p = [
      p[0] + (dt / 6) * (v[0] + 2 * v2[0] + 2 * v3[0] + v4[0]),
      p[1] + (dt / 6) * (v[1] + 2 * v2[1] + 2 * v3[1] + v4[1]),
      p[2] + (dt / 6) * (v[2] + 2 * v2[2] + 2 * v3[2] + v4[2]),
    ];
    v = [
      v[0] + (dt / 6) * (k1v[0] + 2 * k2v[0] + 2 * k3v[0] + k4v[0]),
      v[1] + (dt / 6) * (k1v[1] + 2 * k2v[1] + 2 * k3v[1] + k4v[1]),
      v[2] + (dt / 6) * (k1v[2] + 2 * k2v[2] + 2 * k3v[2] + k4v[2]),
    ];
  }

  return {
    position: p,
    velocityKms: [
      v[0] / PC_PER_MYR_PER_KMS,
      v[1] / PC_PER_MYR_PER_KMS,
      v[2] / PC_PER_MYR_PER_KMS,
    ],
  };
}

/** Lz per unit mass, in pc^2/Myr; negative for the Sun's rotation sense. */
export function angularMomentumZ(p: Vec3, vKms: Vec3): number {
  const v = toPcPerMyr(vKms);
  return p[0] * v[1] - p[1] * v[0];
}

function radialPotential(radiusPc: number): number {
  const r = Math.min(radiusPc, FLOOR_RADIUS_PC);
  const inner =
    CURVE_INTERCEPT * CURVE_INTERCEPT * Math.log(r) +
    2 * CURVE_SLOPE * CURVE_INTERCEPT * r +
    0.5 * CURVE_SLOPE * CURVE_SLOPE * r * r;
  if (radiusPc <= FLOOR_RADIUS_PC) return inner;
  return inner + MIN_SPEED * MIN_SPEED * Math.log(radiusPc / FLOOR_RADIUS_PC);
}

/** Energy per unit mass, in (pc/Myr)^2. */
export function specificEnergy(p: Vec3, vKms: Vec3): number {
  const v = toPcPerMyr(vKms);
  const kinetic = 0.5 * (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
  return kinetic + radialPotential(Math.hypot(p[0], p[1])) + 0.5 * NU * NU * p[2] * p[2];
}
