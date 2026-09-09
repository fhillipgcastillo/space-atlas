import {
  Color,
  GLSL3,
  LessDepth,
  type Material,
  NearestFilter,
  NoBlending,
  type Object3D,
  type PerspectiveCamera,
  type Points,
  RawShaderMaterial,
  RGBAFormat,
  type Scene,
  UnsignedByteType,
  Vector2,
  Vector3,
  type WebGLRenderer,
  WebGLRenderTarget,
} from 'three';
import { decodePickId, MAX_VERTICES_PER_TILE, type PickId } from './pickIds.js';
import { NO_CUTOFF } from './pointMaterial.js';

// Sub-pixel stars need a hit area larger than the point they are drawn as, and
// never smaller than the widest star the visual pass can draw (uMaxSize, 8).
const PICK_POINT_SIZE_CSS = 6;
const MIN_PICK_POINT_SIZE = 10;
const SCISSOR_RADIUS = 2;

const VERTEX = /* glsl */ `
precision highp float;
precision highp int;

uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform vec3 uBboxMin;
uniform vec3 uBboxExtent;
uniform float uTileSlot;
uniform float uPickPointSize;
uniform float uMaxOriginDistance;
uniform float uMaxCameraDistance;
uniform float uTimeYears;
uniform float uVelocityScale;

in vec3 position;
in vec3 aVelocity;
in float aTypeFlags;

flat out uint vPickId;
flat out uint vModeled;
out float vFragDepth;

void main() {
  // aTypeFlags arrives normalized; FLAG_MODELED is bit 0x10 of the raw byte.
  float flagBits = floor(aTypeFlags * 255.0 + 0.5);
  vModeled = mod(floor(flagBits / 16.0), 2.0) > 0.5 ? 1u : 0u;

  vPickId = uint(uTileSlot) * ${MAX_VERTICES_PER_TILE}u + uint(gl_VertexID) + 1u;
  vFragDepth = 1.0;

  if (vModeled == 1u) {
    // A modeled point is not a measurement, so it must never resolve as a hit.
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    return;
  }

  // Same drift and same cutoffs as pointMaterial's vertex shader: a hit has to
  // be where the point is drawn at time t, and points the visual pass culled
  // must not resolve at all.
  vec3 layerPosition =
      uBboxMin + position * uBboxExtent + aVelocity * uTimeYears * uVelocityScale;
  vec4 viewPosition = modelViewMatrix * vec4(layerPosition, 1.0);

  if (length(layerPosition) > uMaxOriginDistance ||
      length(viewPosition.xyz) > uMaxCameraDistance) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    return;
  }

  gl_PointSize = uPickPointSize;
  gl_Position = projectionMatrix * viewPosition;
  vFragDepth = 1.0 + gl_Position.w;
}
`;

const FRAGMENT = /* glsl */ `
precision highp float;
precision highp int;

uniform float uLogDepthBufFC;

flat in uint vPickId;
flat in uint vModeled;
in float vFragDepth;

out vec4 fragColour;

void main() {
  if (vModeled == 1u) discard;

  // Four decades of depth range: a linear 1/z buffer resolves only tens of
  // light-years at kiloparsec distances, so two stars on one line of sight tie
  // and the draw order decides the hit. Logarithmic depth keeps them apart.
  gl_FragDepth = log2(vFragDepth) * uLogDepthBufFC * 0.5;
  fragColour = vec4(
    float(vPickId & 255u) / 255.0,
    float((vPickId >> 8u) & 255u) / 255.0,
    float((vPickId >> 16u) & 255u) / 255.0,
    float((vPickId >> 24u) & 255u) / 255.0
  );
}
`;

export function createPickMaterial(): RawShaderMaterial {
  return new RawShaderMaterial({
    glslVersion: GLSL3,
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: {
      uBboxMin: { value: new Vector3() },
      uBboxExtent: { value: new Vector3(1, 1, 1) },
      uTileSlot: { value: 0 },
      uPickPointSize: { value: MIN_PICK_POINT_SIZE },
      uLogDepthBufFC: { value: 1 },
      uMaxOriginDistance: { value: NO_CUTOFF },
      uMaxCameraDistance: { value: NO_CUTOFF },
      uTimeYears: { value: 0 },
      uVelocityScale: { value: 0 },
    },
    transparent: false,
    // The identifier is bit-exact colour, so nothing may blend it.
    blending: NoBlending,
    depthTest: true,
    depthFunc: LessDepth,
    depthWrite: true,
  });
}

const hasMaterial = (object: Object3D): object is Object3D & { material: Material | Material[] } =>
  'material' in object;

const tileSlotOf = (object: Object3D): number | undefined => {
  const slot = object.userData['tileSlot'];
  return typeof slot === 'number' ? slot : undefined;
};

/**
 * Renders object identifiers to an off-screen target and reads back the pixel
 * under the cursor. The scissor bounds fragment work to the cursor region;
 * vertex work still scales with the points currently streamed in.
 */
export class PickingPass {
  private readonly target: WebGLRenderTarget;
  private readonly buffer = new Uint8Array(4);
  private readonly size = new Vector2();
  private readonly clearColour = new Color();
  private readonly restoreMaterial: { object: Points; material: Material | Material[] }[] = [];
  private readonly restoreVisible: Object3D[] = [];

  constructor(
    private readonly renderer: WebGLRenderer,
    private readonly scene: Scene,
    private readonly camera: PerspectiveCamera,
  ) {
    this.target = new WebGLRenderTarget(1, 1, {
      format: RGBAFormat,
      type: UnsignedByteType,
      minFilter: NearestFilter,
      magFilter: NearestFilter,
      depthBuffer: true,
      stencilBuffer: false,
    });
  }

  /**
   * `x` and `y` are CSS pixels with origin at the top left. The returned view is
   * reused by the next call; decode it before picking again.
   */
  readPixel(x: number, y: number): Uint8Array {
    const size = this.renderer.getDrawingBufferSize(this.size);
    this.target.setSize(size.width, size.height);

    const pixelRatio = this.renderer.getPixelRatio();
    const clamp = (value: number, limit: number): number =>
      Math.min(Math.max(value, 0), Math.max(limit - 1, 0));
    const deviceX = clamp(Math.floor(x * pixelRatio), size.width);
    const deviceY = clamp(size.height - 1 - Math.floor(y * pixelRatio), size.height);

    // While a render target is bound Three takes the scissor from the target,
    // not from the renderer, and in target pixels rather than CSS pixels.
    this.target.scissor.set(
      deviceX - SCISSOR_RADIUS,
      deviceY - SCISSOR_RADIUS,
      SCISSOR_RADIUS * 2 + 1,
      SCISSOR_RADIUS * 2 + 1,
    );
    this.target.scissorTest = true;

    const previousTarget = this.renderer.getRenderTarget();
    const previousColour = this.renderer.getClearColor(this.clearColour).getHex();
    const previousAlpha = this.renderer.getClearAlpha();
    const previousAutoClear = this.renderer.autoClear;

    try {
      this.renderer.setRenderTarget(this.target);
      this.renderer.setClearColor(0x000000, 0);
      // Three's own clear is the one that forces the depth write mask open; a
      // bare renderer.clear() here would be masked out by the visual pass.
      this.renderer.autoClear = true;
      this.renderScene(pixelRatio);
      this.renderer.readRenderTargetPixels(this.target, deviceX, deviceY, 1, 1, this.buffer);
    } finally {
      this.target.scissorTest = false;
      this.renderer.autoClear = previousAutoClear;
      this.renderer.setClearColor(previousColour, previousAlpha);
      this.renderer.setRenderTarget(previousTarget);
    }
    return this.buffer;
  }

  pickAt(x: number, y: number): PickId | null {
    return decodePickId(this.readPixel(x, y));
  }

  dispose(): void {
    this.scene.traverse((object) => {
      const pick = object.userData['pickMaterial'];
      if (pick instanceof RawShaderMaterial) {
        pick.dispose();
        delete object.userData['pickMaterial'];
      }
    });
    this.target.dispose();
  }

  private renderScene(pixelRatio: number): void {
    this.restoreMaterial.length = 0;
    this.restoreVisible.length = 0;
    try {
      this.scene.traverse((object) => {
        if (!hasMaterial(object)) return;
        const slot = tileSlotOf(object);
        const visual = object.material;
        if (slot === undefined || Array.isArray(visual)) {
          // Anything without a slot would otherwise paint its visual colour
          // into the identifier target and read back as a bogus hit.
          if (object.visible) {
            this.restoreVisible.push(object);
            object.visible = false;
          }
          return;
        }
        const mesh = object as Points;
        this.restoreMaterial.push({ object: mesh, material: visual });
        mesh.material = this.pickMaterialFor(mesh, slot, visual, pixelRatio);
      });
      this.renderer.render(this.scene, this.camera);
    } finally {
      for (const entry of this.restoreMaterial) entry.object.material = entry.material;
      for (const object of this.restoreVisible) object.visible = true;
      this.restoreMaterial.length = 0;
      this.restoreVisible.length = 0;
    }
  }

  private pickMaterialFor(
    mesh: Points,
    slot: number,
    visual: Material,
    pixelRatio: number,
  ): RawShaderMaterial {
    let pick = mesh.userData['pickMaterial'];
    if (!(pick instanceof RawShaderMaterial)) {
      pick = createPickMaterial();
      mesh.userData['pickMaterial'] = pick;
    }
    const material = pick as RawShaderMaterial;
    material.uniforms['uTileSlot']!.value = slot;
    material.uniforms['uPickPointSize']!.value = Math.max(
      PICK_POINT_SIZE_CSS * pixelRatio,
      MIN_PICK_POINT_SIZE,
    );
    material.uniforms['uLogDepthBufFC']!.value = 2.0 / Math.log2(this.camera.far + 1.0);

    // Every geometry-affecting uniform is mirrored from this mesh's own visual
    // material rather than recomputed: the clock and the per-layer velocity
    // scale then cannot drift apart from what was drawn, and the pick needs no
    // knowledge of which layer the mesh belongs to.
    const source = (visual as RawShaderMaterial).uniforms;
    material.uniforms['uBboxMin']!.value = source?.['uBboxMin']?.value ?? new Vector3();
    material.uniforms['uBboxExtent']!.value = source?.['uBboxExtent']?.value ?? new Vector3(1, 1, 1);
    material.uniforms['uTimeYears']!.value = source?.['uTimeYears']?.value ?? 0;
    material.uniforms['uVelocityScale']!.value = source?.['uVelocityScale']?.value ?? 0;
    material.uniforms['uMaxOriginDistance']!.value =
      source?.['uMaxOriginDistance']?.value ?? NO_CUTOFF;
    material.uniforms['uMaxCameraDistance']!.value =
      source?.['uMaxCameraDistance']?.value ?? NO_CUTOFF;
    return material;
  }
}
