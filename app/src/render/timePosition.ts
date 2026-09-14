import { circularSpeed, orbitPosition, R0_PC, Z_SUN_PC, type Vec3 } from './galacticOrbit.js';
import { DEEP_MODEL_HUBBLE, DEEP_MODEL_ORBIT } from './pointMaterial.js';

// Mirrors T_HUBBLE_YEARS in TIME_POSITION_GLSL.
export const T_HUBBLE_YEARS = 13.97e9;

/** The deep-time branch of TIME_POSITION_GLSL, as the drawn material configures it. */
export interface DeepTimeState {
  model: number;
  layerParsecsPerUnit: number;
  solarMotionKms: Vec3;
}

/** Everything TIME_POSITION_GLSL needs beyond the point itself. */
export interface TimeState {
  years: number;
  velocityScale: number;
  deep?: DeepTimeState;
}

function circularVelocityKms(galPc: Vec3): Vec3 {
  const r = Math.hypot(galPc[0], galPc[1]);
  if (!(r > 0)) return [0, 0, 0];
  const scale = circularSpeed(r) / r;
  return [galPc[1] * scale, -galPc[0] * scale, 0];
}

function deepPosition(
  base: Vec3,
  velocityKms: Vec3,
  modeled: boolean,
  timeYears: number,
  deep: DeepTimeState,
): Vec3 {
  const unit = deep.layerParsecsPerUnit;
  const galPc: Vec3 = [base[0] * unit - R0_PC, base[1] * unit, base[2] * unit + Z_SUN_PC];
  const galVelocity: Vec3 = modeled
    ? circularVelocityKms(galPc)
    : [
        velocityKms[0] + deep.solarMotionKms[0],
        velocityKms[1] + deep.solarMotionKms[1],
        velocityKms[2] + deep.solarMotionKms[2],
      ];
  const orbit = orbitPosition(galPc, galVelocity, timeYears);
  // Every modeled point stores vz = 0, and the shader holds their height fixed.
  const z = modeled ? galPc[2] : orbit[2];
  return [(orbit[0] + R0_PC) / unit, orbit[1] / unit, (z - Z_SUN_PC) / unit];
}

/** Where TIME_POSITION_GLSL puts a point at `timeYears`, in the layer's own units. */
export function positionAtTime(
  base: Vec3,
  velocityKms: Vec3,
  modeled: boolean,
  timeYears: number,
  velocityScale: number,
  deep?: DeepTimeState,
): Vec3 {
  if (deep?.model === DEEP_MODEL_ORBIT) {
    return deepPosition(base, velocityKms, modeled, timeYears, deep);
  }
  const stretch = deep?.model === DEEP_MODEL_HUBBLE ? 1 + timeYears / T_HUBBLE_YEARS : 1;
  return [
    base[0] * stretch + velocityKms[0] * timeYears * velocityScale,
    base[1] * stretch + velocityKms[1] * timeYears * velocityScale,
    base[2] * stretch + velocityKms[2] * timeYears * velocityScale,
  ];
}
