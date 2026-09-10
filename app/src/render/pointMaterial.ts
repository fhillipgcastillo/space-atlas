import {
  AdditiveBlending,
  DataTexture,
  GLSL3,
  LinearFilter,
  RawShaderMaterial,
  RGBAFormat,
  UnsignedByteType,
  Vector3,
} from 'three';
import { buildColourRamp } from './colourRamp.js';
import { SOLAR_MOTION_KMS } from './galacticOrbit.js';

export const DEEP_MODEL_LINEAR = 0;
export const DEEP_MODEL_ORBIT = 1;
export const DEEP_MODEL_HUBBLE = 2;

/**
 * Where a point sits at uTimeYears. Included verbatim by both the visual and the
 * picking vertex shader, which have to place a point identically; the orbit is a
 * port of galacticOrbit.ts, which stays the reference for the constants and the form.
 */
export const TIME_POSITION_GLSL = /* glsl */ `
uniform float uTimeYears;
uniform float uVelocityScale;
uniform float uDeepTime;
uniform float uDeepModel;
// This layer's own unit. uParsecsPerUnit follows the active layer instead, for
// view-space distances, and is the wrong scale for these positions.
uniform float uLayerParsecsPerUnit;
uniform vec3 uSolarMotion;

const float R0_PC = 8122.0;
const float Z_SUN_PC = 20.8;
const float V_CIRC_KMS = 234.6;
const float CURVE_SLOPE_KMS_PER_PC = -0.0017;
const float MIN_CIRCULAR_SPEED_KMS = 20.0;
// Where the extrapolated curve reaches the floor speed.
const float FLOOR_RADIUS_PC = 134357.294;
const float PC_PER_MYR_PER_KMS = 1.0227121650456950;
// sqrt(4 pi G rho0), per Myr.
const float NU_PER_MYR = 0.0751863320320799;
const float T_HUBBLE_YEARS = 13.97e9;

float circularSpeedKms(float radiusPc) {
  return max(V_CIRC_KMS + CURVE_SLOPE_KMS_PER_PC * (radiusPc - R0_PC), MIN_CIRCULAR_SPEED_KMS);
}

float epicyclicFrequency(float radiusPc) {
  float omega = circularSpeedKms(radiusPc) / radiusPc;
  float slope = radiusPc < FLOOR_RADIUS_PC ? CURVE_SLOPE_KMS_PER_PC : 0.0;
  return sqrt(2.0 * omega * (omega + slope));
}

// The fixed point contracts by about 0.06 a step, so eight is past float precision.
float guidingRadius(float lzMagnitude) {
  float radius = lzMagnitude / (V_CIRC_KMS * PC_PER_MYR_PER_KMS);
  for (int i = 0; i < 8; i++) {
    radius = lzMagnitude / (circularSpeedKms(radius) * PC_PER_MYR_PER_KMS);
  }
  return radius;
}

// GLSL trig is only specified to be accurate inside one turn, and an inner-disk
// point runs through twenty of them in 250 Myr.
float wrapAngle(float angle) {
  return angle - 6.283185307179586 * floor(angle / 6.283185307179586 + 0.5);
}

vec3 galacticOrbit(vec3 posPc, vec3 velocityKms, float tMyr) {
  vec3 v = velocityKms * PC_PER_MYR_PER_KMS;
  float r0 = length(posPc.xy);
  float lz = posPc.x * v.y - posPc.y * v.x;
  // |Lz|: the Sun's Lz is negative here, and a signed guiding radius puts the
  // star on the far side of the Galaxy.
  float rg = guidingRadius(abs(lz));
  if (r0 <= 0.0 || rg <= 0.0) return posPc + v * tMyr;

  float vr0 = dot(posPc.xy, v.xy) / r0;
  float phi0 = atan(posPc.y, posPc.x);
  float kappa = epicyclicFrequency(rg) * PC_PER_MYR_PER_KMS;
  float omegaG = lz / (rg * rg);
  float amplitude = length(vec2(r0 - rg, vr0 / kappa));
  float a0 = amplitude > 0.0 ? atan(-vr0 / kappa, r0 - rg) : 0.0;

  float phase = wrapAngle(kappa * tMyr + a0);
  float r = rg + amplitude * cos(phase);
  float phi = wrapAngle(phi0 + omegaG * tMyr
      - (2.0 * omegaG * amplitude) / (kappa * rg) * (sin(phase) - sin(a0)));
  float vertical = wrapAngle(NU_PER_MYR * tMyr);
  float z = posPc.z * cos(vertical) + (v.z / NU_PER_MYR) * sin(vertical);
  return vec3(r * cos(phi), r * sin(phi), z);
}

vec3 circularVelocityKms(vec3 posPc) {
  float r = length(posPc.xy);
  if (r <= 0.0) return vec3(0.0);
  return vec3(posPc.y, -posPc.x, 0.0) * (circularSpeedKms(r) / r);
}

vec3 timePosition(vec3 basePosition, vec3 velocityKms, float modeled) {
  vec3 drift = velocityKms * uTimeYears * uVelocityScale;
  if (uDeepTime < 0.5 || uDeepModel < 0.5) return basePosition + drift;
  if (uDeepModel > 1.5) {
    return basePosition * (1.0 + uTimeYears / T_HUBBLE_YEARS) + drift;
  }

  vec3 helioPc = basePosition * uLayerParsecsPerUnit;
  vec3 galPc = vec3(helioPc.x - R0_PC, helioPc.y, helioPc.z + Z_SUN_PC);
  vec3 galVelocity = modeled > 0.5 ? circularVelocityKms(galPc) : velocityKms + uSolarMotion;
  vec3 orbit = galacticOrbit(galPc, galVelocity, uTimeYears * 1e-6);
  // Every modeled point has vz = 0, so one shared vertical phase would flatten
  // the whole population into a plane every quarter period.
  if (modeled > 0.5) orbit.z = galPc.z;
  return vec3(orbit.x + R0_PC, orbit.y, orbit.z - Z_SUN_PC) / uLayerParsecsPerUnit;
}
`;

const VERTEX = /* glsl */ `
precision highp float;

uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform vec3 uBboxMin;
uniform vec3 uBboxExtent;
uniform float uPixelRatio;
uniform float uSizeScale;
uniform float uMinSize;
uniform float uMaxSize;
uniform float uAlphaScale;
uniform float uMinAlpha;
uniform float uFaintBoost;
uniform float uParsecsPerUnit;
uniform float uModeledDim;
uniform float uShowModeled;
uniform float uFluxWeight;
uniform float uMaxOriginDistance;
uniform float uMaxCameraDistance;

${TIME_POSITION_GLSL}

in vec3 position;
in vec3 aVelocity;
in float aColourIndex;
in float aAbsMag;
in float aTypeFlags;

out float vColourIndex;
out float vAlpha;

void main() {
  // aTypeFlags arrives normalized; FLAG_MODELED is bit 0x10 of the raw byte.
  float flagBits = floor(aTypeFlags * 255.0 + 0.5);
  float modeled = mod(floor(flagBits / 16.0), 2.0);

  if (modeled > 0.5 && uShowModeled < 0.5) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    vColourIndex = 0.0;
    vAlpha = 0.0;
    return;
  }

  // The drift lands before the distance term, so a star's apparent magnitude
  // tracks where it is at time t, not where it was at t = 0.
  vec3 layerPosition = timePosition(uBboxMin + position * uBboxExtent, aVelocity, modeled);
  vec4 viewPosition = modelViewMatrix * vec4(layerPosition, 1.0);

  // Hard binary cutoff by design (spec 6.1): no fade band, no alpha ramp.
  // uMaxOriginDistance is in this layer's units, matching layerPosition;
  // uMaxCameraDistance is in the active layer's, matching viewPosition.
  if (length(layerPosition) > uMaxOriginDistance ||
      length(viewPosition.xyz) > uMaxCameraDistance) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    vColourIndex = 0.0;
    vAlpha = 0.0;
    return;
  }

  float distancePc = max(length(viewPosition.xyz) * uParsecsPerUnit, 1e-6);
  float apparentMag = aAbsMag + 5.0 * (log2(distancePc) / log2(10.0)) - 5.0;
  // Scaling brightness, not alpha: a subsample standing in for eight points
  // should read as eight points of light, in size as well as opacity.
  float brightness = pow(10.0, -0.4 * apparentMag) * uFluxWeight;

  gl_PointSize = clamp(uSizeScale * sqrt(brightness) * uPixelRatio, uMinSize, uMaxSize);
  // Flux spans many decades, so a linear map has no exposure that shows a faint
  // star without saturating a bright one. asinh is linear at the faint end and
  // logarithmic at the bright end -- the stretch imaging uses for the same
  // reason. uFaintBoost = 1 reduces to the old linear response.
  float gained = brightness * uAlphaScale;
  float stretched = uFaintBoost > 1.0
      ? asinh(gained * uFaintBoost) / asinh(uFaintBoost)
      : gained;
  // The dim factor is applied after the clamp: below the floor an undimmed and a
  // dimmed modeled point would otherwise emit the same light.
  vAlpha = clamp(stretched, uMinAlpha, 1.0) * mix(1.0, uModeledDim, modeled);
  vColourIndex = aColourIndex;

  gl_Position = projectionMatrix * viewPosition;
}
`;

const FRAGMENT = /* glsl */ `
precision highp float;

uniform sampler2D uColourRamp;
uniform float uLayerOpacity;

in float vColourIndex;
in float vAlpha;

out vec4 fragColour;

void main() {
  vec2 offset = gl_PointCoord - 0.5;
  float radiusSq = dot(offset, offset);
  if (radiusSq > 0.25) discard;

  float falloff = exp(-radiusSq * 12.0);
  vec3 tint = texture(uColourRamp, vec2(vColourIndex, 0.5)).rgb;

  fragColour = vec4(tint * falloff * vAlpha * uLayerOpacity, 1.0);
}
`;

// Chosen on real hardware. Measured through a software rasterizer at 8.2M
// points, 1000 ly: 800 gives mean luminance ~44 and ~83% lit pixels.
const DEFAULT_ALPHA_SCALE = 8.0e2;

/**
 * Stands in for an unlimited cutoff. Infinity round-trips through a float
 * uniform on paper but not on every driver; this is far past any layer range.
 */
export const NO_CUTOFF = 1e30;

/** Modeled points emit this fraction of the light a measured point of the same magnitude would. */
export const DEFAULT_MODELED_DIM = 0.45;

export const DEFAULT_SIZE_SCALE = 500;
export const DEFAULT_MIN_SIZE = 1;
export const DEFAULT_MIN_ALPHA = 0.02;

/**
 * Knee of the asinh response: higher lifts faint points further. 1 is linear.
 * Defaults to linear because measurement did not support a change: at a Milky
 * Way view, matching the linear lit fraction costs slightly more blow-out
 * (71.5% lit at 3.93% blown, against 3.79% linear). Both curves clip at the
 * same white point, so the stretch trades rather than wins. It is a control,
 * not a better default.
 */
export const DEFAULT_FAINT_BOOST = 1;
// Headroom for flux compensation: a node standing in for 30x its own points
// needs sqrt(30) ~ 5.5x the radius, which clipped at 8.
export const DEFAULT_MAX_SIZE = 24;

export type PointUniformName =
  | 'uAlphaScale'
  | 'uSizeScale'
  | 'uMinSize'
  | 'uMaxSize'
  | 'uMinAlpha'
  | 'uFaintBoost';

const pointUniforms: Record<PointUniformName, number> = {
  uAlphaScale: DEFAULT_ALPHA_SCALE,
  uSizeScale: DEFAULT_SIZE_SCALE,
  uMinSize: DEFAULT_MIN_SIZE,
  uMaxSize: DEFAULT_MAX_SIZE,
  uMinAlpha: DEFAULT_MIN_ALPHA,
  uFaintBoost: DEFAULT_FAINT_BOOST,
};

// Materials handed out by createPointMaterial. tileMesh clones one of these per
// tile, so changing a value here only reaches tiles streamed in afterwards;
// Viewer.setPointUniform updates the live clones as well. Held weakly so the
// registry cannot pin a material the caller has disposed.
const baseMaterials = new Set<WeakRef<RawShaderMaterial>>();

export function getPointUniform(name: PointUniformName): number {
  return pointUniforms[name];
}

export function setPointUniform(name: PointUniformName, value: number): void {
  pointUniforms[name] = value;
  for (const ref of baseMaterials) {
    const material = ref.deref();
    if (material) material.uniforms[name]!.value = value;
    else baseMaterials.delete(ref);
  }
}

export function getAlphaScale(): number {
  return getPointUniform('uAlphaScale');
}

export function setAlphaScale(value: number): void {
  setPointUniform('uAlphaScale', value);
}

export function createPointMaterial(unitInParsecs: number): RawShaderMaterial {
  const ramp = new DataTexture(buildColourRamp(256), 256, 1, RGBAFormat, UnsignedByteType);
  ramp.minFilter = LinearFilter;
  ramp.magFilter = LinearFilter;
  ramp.needsUpdate = true;

  const material = new RawShaderMaterial({
    glslVersion: GLSL3,
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: {
      uBboxMin: { value: new Vector3() },
      uBboxExtent: { value: new Vector3(1, 1, 1) },
      uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
      uSizeScale: { value: pointUniforms.uSizeScale },
      uMinSize: { value: pointUniforms.uMinSize },
      uMaxSize: { value: pointUniforms.uMaxSize },
      uAlphaScale: { value: pointUniforms.uAlphaScale },
      uMinAlpha: { value: pointUniforms.uMinAlpha },
      uFaintBoost: { value: pointUniforms.uFaintBoost },
      uParsecsPerUnit: { value: unitInParsecs },
      uModeledDim: { value: DEFAULT_MODELED_DIM },
      uShowModeled: { value: 1 },
      uFluxWeight: { value: 1 },
      uMaxOriginDistance: { value: NO_CUTOFF },
      uMaxCameraDistance: { value: NO_CUTOFF },
      uTimeYears: { value: 0 },
      uVelocityScale: { value: 0 },
      uDeepTime: { value: 0 },
      uDeepModel: { value: DEEP_MODEL_LINEAR },
      uLayerParsecsPerUnit: { value: unitInParsecs },
      uSolarMotion: { value: new Vector3(...SOLAR_MOTION_KMS) },
      uLayerOpacity: { value: 1 },
      uColourRamp: { value: ramp },
    },
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: AdditiveBlending,
  });

  baseMaterials.add(new WeakRef(material));
  return material;
}
