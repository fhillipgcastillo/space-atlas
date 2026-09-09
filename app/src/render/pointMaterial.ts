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

in vec3 position;
in float aColourIndex;
in float aAbsMag;

out float vColourIndex;
out float vAlpha;

void main() {
  vec3 layerPosition = uBboxMin + position * uBboxExtent;
  vec4 viewPosition = modelViewMatrix * vec4(layerPosition, 1.0);

  float distancePc = max(length(viewPosition.xyz) * uParsecsPerUnit, 1e-6);
  float apparentMag = aAbsMag + 5.0 * (log2(distancePc) / log2(10.0)) - 5.0;
  float brightness = pow(10.0, -0.4 * apparentMag);

  gl_PointSize = clamp(uSizeScale * sqrt(brightness) * uPixelRatio, uMinSize, uMaxSize);
  vAlpha = clamp(brightness * uAlphaScale, 0.02, 1.0);
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
