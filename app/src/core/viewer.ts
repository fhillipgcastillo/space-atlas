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
} from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import {
  getAlphaScale as getPointAlphaScale,
  setAlphaScale as setPointAlphaScale,
} from '../render/pointMaterial.js';
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

export class Viewer {
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  readonly renderer: WebGLRenderer;
  readonly controls: FlyControls;

  private readonly composer: EffectComposer;
  private readonly bloom: UnrealBloomPass;
  private readonly callbacks: ((dt: number) => void)[] = [];
  private lastFrame = performance.now();
  private running = false;

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

  getAlphaScale(): number {
    return getPointAlphaScale();
  }

  setAlphaScale(value: number): void {
    setPointAlphaScale(value);
    // createTileMesh clones the material per tile, so already-streamed tiles
    // hold their own copy of the uniform and have to be walked.
    this.scene.traverse((object) => {
      const material = (object as { material?: Material | Material[] }).material;
      if (!material) return;
      for (const entry of Array.isArray(material) ? material : [material]) {
        const uniform = (entry as ShaderMaterial).uniforms?.['uAlphaScale'];
        if (uniform) uniform.value = value;
      }
    });
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
    this.composer.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private readonly tick = (): void => {
    const now = performance.now();
    const dt = (now - this.lastFrame) / 1000;
    this.lastFrame = now;

    // Clamped only for motion: a long stall must not teleport the camera. The
    // callbacks see the true delta so frame-time telemetry can report stalls.
    this.controls.update(Math.min(dt, 0.1));
    for (const cb of this.callbacks) cb(dt);
    this.composer.render();
  };

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
