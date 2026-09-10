import {
  ACESFilmicToneMapping,
  Color,
  LinearSRGBColorSpace,
  type Material,
  type Object3D,
  PerspectiveCamera,
  Scene,
  type ShaderMaterial,
  Vector2,
  WebGLRenderer,
  type WebGLRenderTarget,
} from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ExposureMeter, adaptExposure, exposureForLuminance } from '../render/autoExposure.js';
import {
  getPointUniform,
  setPointUniform,
  type PointUniformName,
} from '../render/pointMaterial.js';
import { getTimeYears, setTimeYears } from '../render/timeline.js';
import { FlyControls } from './flyControls.js';

// Four decades of distance between the planes; the logarithmic depth buffer is
// what keeps that from collapsing into z-fighting.
const NEAR = 0.001;
const FAR = 1e7;

const BLOOM_STRENGTH = 0.8;
const BLOOM_RADIUS = 0.4;
// Only near-blown-out points bloom; at threshold 0 the 2M-point field smears
// into a uniform white sheet instead of reading as stars.
const BLOOM_THRESHOLD = 0.9;

// readRenderTargetPixels drains the GPU queue before it returns, so each sample
// costs a whole frame's worth of pending work. Four a second while the exposure
// is still moving; once it settles, back off -- a static view has nothing to
// measure, and at low frame rates the fixed interval fires almost every frame.
const MEASURE_INTERVAL_SECONDS = 0.25;
const MAX_MEASURE_INTERVAL_SECONDS = 2;
const SETTLED_FRACTION = 0.02;

export class Viewer {
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  readonly renderer: WebGLRenderer;
  readonly controls: FlyControls;

  private readonly composer: EffectComposer;
  private readonly bloom: UnrealBloomPass;
  private readonly callbacks: ((dt: number) => void)[] = [];
  private readonly meter: ExposureMeter;
  private lastFrame = performance.now();
  private running = false;
  private autoExposure = true;
  private sinceMeasure = MEASURE_INTERVAL_SECONDS;
  private measureInterval = MEASURE_INTERVAL_SECONDS;
  private desiredExposure = 1;

  constructor(parent: HTMLElement) {
    this.renderer = new WebGLRenderer({
      antialias: false,
      logarithmicDepthBuffer: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    // Every material in this scene is a RawShaderMaterial, which bypasses three's
    // colour management and emits display-space colour directly. UnrealBloomPass
    // copies the base image with a MeshBasicMaterial, which does get the sRGB
    // encode, so without this the composer encodes an already-encoded frame and
    // washes it out. Anything added to the scene must stay display-space too.
    this.renderer.outputColorSpace = LinearSRGBColorSpace;
    this.renderer.setClearColor(new Color(0x000000), 1);
    parent.appendChild(this.renderer.domElement);

    this.camera = new PerspectiveCamera(60, window.innerWidth / window.innerHeight, NEAR, FAR);
    this.camera.position.set(0, 0, 0.5);

    this.controls = new FlyControls(this.camera, this.renderer.domElement);

    this.bloom = new UnrealBloomPass(
      new Vector2(window.innerWidth, window.innerHeight),
      BLOOM_STRENGTH,
      BLOOM_RADIUS,
      BLOOM_THRESHOLD,
    );

    // The composer's targets are half-float, so additive accumulation above 1.0
    // survives the chain; OutputPass is what maps it down instead of clipping.
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1;

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    // Each pass resets info, so a read after composer.render() sees only the
    // final fullscreen pass. Reset once per frame and let it accumulate.
    this.renderer.info.autoReset = false;

    this.meter = new ExposureMeter(this.renderer);

    window.addEventListener('resize', this.onResize);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
  }

  add(object: Object3D): void {
    this.scene.add(object);
  }

  onFrame(cb: (dt: number) => void): void {
    this.callbacks.push(cb);
  }

  getBloomStrength(): number {
    return this.bloom.strength;
  }

  setBloomStrength(value: number): void {
    this.bloom.strength = value;
  }

  getBloomRadius(): number {
    return this.bloom.radius;
  }

  setBloomRadius(value: number): void {
    this.bloom.radius = value;
  }

  getBloomThreshold(): number {
    return this.bloom.threshold;
  }

  setBloomThreshold(value: number): void {
    this.bloom.threshold = value;
  }

  getBloomEnabled(): boolean {
    return this.bloom.enabled;
  }

  setBloomEnabled(enabled: boolean): void {
    this.bloom.enabled = enabled;
  }

  getExposure(): number {
    return this.renderer.toneMappingExposure;
  }

  setExposure(value: number): void {
    this.renderer.toneMappingExposure = Math.max(value, 0);
  }

  getAutoExposure(): boolean {
    return this.autoExposure;
  }

  setAutoExposure(enabled: boolean): void {
    this.autoExposure = enabled;
    // Measure on the next frame rather than coasting on a stale reading.
    if (enabled) {
      this.sinceMeasure = this.measureInterval;
      this.measureInterval = MEASURE_INTERVAL_SECONDS;
    }
  }

  /** Composes one frame. Measuring the canvas any other way misses tone mapping. */
  renderFrame(): void {
    this.composer.render();
  }

  getFaintBoost(): number {
    return getPointUniform('uFaintBoost');
  }

  setFaintBoost(value: number): void {
    this.setPointUniform('uFaintBoost', Math.max(value, 1));
  }

  getAlphaScale(): number {
    return getPointUniform('uAlphaScale');
  }

  setAlphaScale(value: number): void {
    this.setPointUniform('uAlphaScale', value);
  }

  getSizeScale(): number {
    return getPointUniform('uSizeScale');
  }

  setSizeScale(value: number): void {
    this.setPointUniform('uSizeScale', Math.max(value, 0));
  }

  getMinSize(): number {
    return getPointUniform('uMinSize');
  }

  setMinSize(value: number): void {
    this.setPointUniform('uMinSize', Math.max(value, 0));
  }

  getMaxSize(): number {
    return getPointUniform('uMaxSize');
  }

  setMaxSize(value: number): void {
    this.setPointUniform('uMaxSize', Math.max(value, 0));
  }

  getTimeYears(): number {
    return getTimeYears();
  }

  /**
   * Clamped to the range where p0 + v*t is still defensible. Each LayerRenderer
   * reads the clock in its own update, so this lands on the next frame.
   */
  setTimeYears(years: number): void {
    setTimeYears(years);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastFrame = performance.now();
    this.renderer.setAnimationLoop(this.tick);
  }

  dispose(): void {
    this.running = false;
    this.renderer.setAnimationLoop(null);
    window.removeEventListener('resize', this.onResize);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.controls.dispose();
    this.meter.dispose();
    this.composer.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  // createTileMesh clones the material per tile, so already-streamed tiles hold
  // their own copy of the uniform and have to be walked.
  private setPointUniform(name: PointUniformName, value: number): void {
    setPointUniform(name, value);
    this.scene.traverse((object) => {
      const material = (object as { material?: Material | Material[] }).material;
      if (!material) return;
      for (const entry of Array.isArray(material) ? material : [material]) {
        const uniform = (entry as ShaderMaterial).uniforms?.[name];
        if (uniform) uniform.value = value;
      }
    });
  }

  private readonly tick = (): void => {
    this.renderer.info.reset();
    const now = performance.now();
    const dt = (now - this.lastFrame) / 1000;
    this.lastFrame = now;

    // Clamped only for motion: a long stall must not teleport the camera. The
    // callbacks see the true delta so frame-time telemetry can report stalls.
    this.controls.update(Math.min(dt, 0.1));
    for (const cb of this.callbacks) cb(dt);

    // The passes composite into whichever buffer is the read buffer on entry;
    // OutputPass then swaps, so capture it first to meter the HDR frame the
    // tone mapper saw rather than the clipped canvas.
    const composed = this.composer.readBuffer;
    this.composer.render();
    if (this.autoExposure) this.updateExposure(composed, dt);
  };

  private updateExposure(composed: WebGLRenderTarget, dt: number): void {
    this.sinceMeasure += dt;
    if (this.sinceMeasure >= this.measureInterval) {
      this.sinceMeasure = 0;
      const next = exposureForLuminance(this.meter.measure(composed));
      const settled =
        Math.abs(next - this.desiredExposure) <= SETTLED_FRACTION * Math.max(next, 1e-6);
      this.measureInterval = settled
        ? Math.min(this.measureInterval * 2, MAX_MEASURE_INTERVAL_SECONDS)
        : MEASURE_INTERVAL_SECONDS;
      this.desiredExposure = next;
    }
    this.setExposure(adaptExposure(this.getExposure(), this.desiredExposure, dt));
  }

  // rAF is suspended while the tab is hidden, so the first delta after it wakes
  // would be the time spent away rather than a frame time.
  private readonly onVisibilityChange = (): void => {
    if (!document.hidden) this.lastFrame = performance.now();
  };

  private readonly onResize = (): void => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.composer.setSize(window.innerWidth, window.innerHeight);
  };
}
