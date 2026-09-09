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
uniform float uParsecsPerUnit;
uniform float uModeledDim;
uniform float uShowModeled;
uniform float uFluxWeight;
uniform float uMaxOriginDistance;
uniform float uMaxCameraDistance;

in vec3 position;
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

  vec3 layerPosition = uBboxMin + position * uBboxExtent;
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
  // The dim factor is applied after the clamp: below the 0.02 floor an
  // undimmed and a dimmed modeled point would otherwise emit the same light.
  vAlpha = clamp(brightness * uAlphaScale, 0.02, 1.0) * mix(1.0, uModeledDim, modeled);
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

let alphaScale = DEFAULT_ALPHA_SCALE;
// Materials handed out by createPointMaterial. tileMesh clones one of these per
// tile, so changing the scale here only reaches tiles streamed in afterwards;
// Viewer.setAlphaScale updates the live clones as well. Held weakly so the
// registry cannot pin a material the caller has disposed.
const baseMaterials = new Set<WeakRef<RawShaderMaterial>>();

export function getAlphaScale(): number {
  return alphaScale;
}

export function setAlphaScale(value: number): void {
  alphaScale = value;
  for (const ref of baseMaterials) {
    const material = ref.deref();
    if (material) material.uniforms['uAlphaScale']!.value = value;
    else baseMaterials.delete(ref);
  }
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
      uSizeScale: { value: 500.0 },
      uMinSize: { value: 1.0 },
      uMaxSize: { value: 8.0 },
      uAlphaScale: { value: alphaScale },
      uParsecsPerUnit: { value: unitInParsecs },
      uModeledDim: { value: DEFAULT_MODELED_DIM },
      uShowModeled: { value: 1 },
      uFluxWeight: { value: 1 },
      uMaxOriginDistance: { value: NO_CUTOFF },
      uMaxCameraDistance: { value: NO_CUTOFF },
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
