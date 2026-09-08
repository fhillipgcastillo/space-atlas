import { Euler, type PerspectiveCamera, Vector3 } from 'three';

export interface SpeedOptions {
  fraction: number;
  min: number;
  max: number;
}

export const DEFAULT_SPEED: SpeedOptions = { fraction: 0.6, min: 0.01, max: 5e5 };

export function speedForDistance(distanceFromOrigin: number, options: SpeedOptions): number {
  const distance = Math.abs(distanceFromOrigin);
  return Math.min(Math.max(distance * options.fraction, options.min), options.max);
}

const KEY_AXES: Record<string, [axis: 0 | 1 | 2, sign: number]> = {
  KeyW: [2, -1],
  KeyS: [2, 1],
  KeyA: [0, -1],
  KeyD: [0, 1],
  KeyQ: [1, -1],
  KeyE: [1, 1],
};

export class FlyControls {
  speedMultiplier = 1;

  private readonly held = new Set<string>();
  private readonly euler = new Euler(0, 0, 0, 'YXZ');
  private readonly move = new Vector3();
  private dragging = false;
  private boosting = false;

  constructor(
    private readonly camera: PerspectiveCamera,
    private readonly element: HTMLElement,
    private readonly speed: SpeedOptions = DEFAULT_SPEED,
  ) {
    this.euler.setFromQuaternion(camera.quaternion);
    element.addEventListener('pointerdown', this.onPointerDown);
    element.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    element.addEventListener('wheel', this.onWheel, { passive: false });
  }

  update(dtSeconds: number): void {
    this.move.set(0, 0, 0);
    for (const code of this.held) {
      const mapping = KEY_AXES[code];
      if (!mapping) continue;
      const [axis, sign] = mapping;
      this.move.setComponent(axis, this.move.getComponent(axis) + sign);
    }
    if (this.move.lengthSq() === 0) return;

    const base = speedForDistance(this.camera.position.length(), this.speed);
    const step = base * this.speedMultiplier * (this.boosting ? 8 : 1) * dtSeconds;
    this.move.normalize().applyQuaternion(this.camera.quaternion).multiplyScalar(step);
    this.camera.position.add(this.move);
  }

  dispose(): void {
    this.element.removeEventListener('pointerdown', this.onPointerDown);
    this.element.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    this.element.removeEventListener('wheel', this.onWheel);
    this.held.clear();
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (event.button === 0) this.dragging = true;
  };

  private readonly onPointerUp = (): void => {
    this.dragging = false;
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (!this.dragging) return;
    this.euler.y -= event.movementX * 0.002;
    this.euler.x -= event.movementY * 0.002;
    // Clamp at the poles so the view never flips upside down.
    this.euler.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this.euler.x));
    this.camera.quaternion.setFromEuler(this.euler);
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    this.held.add(event.code);
    if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') this.boosting = true;
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.held.delete(event.code);
    if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') this.boosting = false;
  };

  private readonly onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    const factor = Math.exp(-event.deltaY * 0.001);
    this.speedMultiplier = Math.min(Math.max(this.speedMultiplier * factor, 0.05), 50);
  };
}
