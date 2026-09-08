import {
  Color,
  type Object3D,
  PerspectiveCamera,
  Scene,
  Vector2,
  WebGLRenderer,
} from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { FlyControls } from './flyControls.js';

// Four decades of distance between the planes; the logarithmic depth buffer is
// what keeps that from collapsing into z-fighting.
const NEAR = 0.001;
const FAR = 1e7;

export class Viewer {
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  readonly renderer: WebGLRenderer;
  readonly controls: FlyControls;

  private readonly composer: EffectComposer;
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
    this.renderer.setClearColor(new Color(0x000000), 1);
    parent.appendChild(this.renderer.domElement);

    this.camera = new PerspectiveCamera(60, window.innerWidth / window.innerHeight, NEAR, FAR);
    this.camera.position.set(0, 0, 0.5);

    this.controls = new FlyControls(this.camera, this.renderer.domElement);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.composer.addPass(
      new UnrealBloomPass(
        new Vector2(window.innerWidth, window.innerHeight),
        0.7, // strength
        0.6, // radius
        0.0, // threshold: points are already dim, so bloom everything
      ),
    );

    window.addEventListener('resize', this.onResize);
  }

  add(object: Object3D): void {
    this.scene.add(object);
  }

  onFrame(cb: (dt: number) => void): void {
    this.callbacks.push(cb);
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
    this.controls.dispose();
    this.composer.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private readonly tick = (): void => {
    const now = performance.now();
    const dt = Math.min((now - this.lastFrame) / 1000, 0.1);
    this.lastFrame = now;

    this.controls.update(dt);
    for (const cb of this.callbacks) cb(dt);
    this.composer.render();
  };

  private readonly onResize = (): void => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.composer.setSize(window.innerWidth, window.innerHeight);
  };
}
