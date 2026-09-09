import {
  FloatType,
  NearestFilter,
  RGBAFormat,
  ShaderMaterial,
  type WebGLRenderer,
  WebGLRenderTarget,
} from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

export const TARGET_LUMINANCE = 0.18;
const MIN_EXPOSURE = 1 / 512;
// The modeled-versus-measured dimming ratio compresses toward 1 as exposure
// rises - measured 0.483 at exposure 1 and 0.558 at exposure 4 - so the
// ceiling is set just above what the far view needs rather than left wide.
const MAX_EXPOSURE = 16;
const DEFAULT_HALF_LIFE_SECONDS = 0.6;

const METER_SIZE = 64;
// Taps per axis inside each output cell; deterministic and evenly spread, so a
// still camera samples the same texels every time and adds no temporal jitter.
const TAPS = 8;
// Caps a cell so one runaway pixel cannot dominate the frame's mean.
const MAX_SAMPLE = 30000;

export function exposureForLuminance(
  averageLuminance: number,
  target = TARGET_LUMINANCE,
): number {
  if (!(averageLuminance > 0)) return MAX_EXPOSURE;
  return Math.min(Math.max(target / averageLuminance, MIN_EXPOSURE), MAX_EXPOSURE);
}

export function adaptExposure(
  current: number,
  desired: number,
  dtSeconds: number,
  halfLifeSeconds = DEFAULT_HALF_LIFE_SECONDS,
): number {
  if (!(dtSeconds > 0) || !(halfLifeSeconds > 0)) return current;
  // Frame-rate independent: the fraction of the gap closed depends on elapsed
  // time, not on how many frames it took.
  const k = 1 - Math.pow(0.5, dtSeconds / halfLifeSeconds);
  return current + (desired - current) * k;
}

const VERTEX = /* glsl */ `
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAGMENT = /* glsl */ `
uniform sampler2D tSource;
uniform float uCell;

varying vec2 vUv;

void main() {
  vec2 origin = vUv - vec2(uCell * 0.5);
  float stride = uCell / float(${TAPS});
  float sum = 0.0;
  for (int y = 0; y < ${TAPS}; y++) {
    for (int x = 0; x < ${TAPS}; x++) {
      vec2 at = origin + (vec2(float(x), float(y)) + 0.5) * stride;
      vec3 c = texture2D(tSource, at).rgb;
      sum += dot(c, vec3(0.2126, 0.7152, 0.0722));
    }
  }
  float mean = min(sum / float(${TAPS * TAPS}), ${MAX_SAMPLE}.0);
  gl_FragColor = vec4(mean, 0.0, 0.0, 1.0);
}
`;

export class ExposureMeter {
  private readonly target: WebGLRenderTarget;
  private readonly material: ShaderMaterial;
  private readonly quad: FullScreenQuad;
  private readonly buffer: Float32Array;

  constructor(
    private readonly renderer: WebGLRenderer,
    private readonly size = METER_SIZE,
  ) {
    this.target = new WebGLRenderTarget(this.size, this.size, {
      format: RGBAFormat,
      type: FloatType,
      minFilter: NearestFilter,
      magFilter: NearestFilter,
      depthBuffer: false,
      stencilBuffer: false,
    });
    this.material = new ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: {
        tSource: { value: null },
        uCell: { value: 1 / this.size },
      },
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new FullScreenQuad(this.material);
    this.buffer = new Float32Array(this.size * this.size * 4);
  }

  measure(source: WebGLRenderTarget): number {
    this.material.uniforms['tSource']!.value = source.texture;
    const previousTarget = this.renderer.getRenderTarget();
    try {
      this.renderer.setRenderTarget(this.target);
      this.quad.render(this.renderer);
      this.renderer.readRenderTargetPixels(this.target, 0, 0, this.size, this.size, this.buffer);
    } finally {
      this.renderer.setRenderTarget(previousTarget);
      this.material.uniforms['tSource']!.value = null;
    }

    let sum = 0;
    let count = 0;
    for (let i = 0; i < this.buffer.length; i += 4) {
      const value = this.buffer[i]!;
      if (!Number.isFinite(value)) continue;
      sum += value;
      count++;
    }
    return count > 0 ? sum / count : 0;
  }

  dispose(): void {
    this.quad.dispose();
    this.material.dispose();
    this.target.dispose();
  }
}
