import { Vector3, type PerspectiveCamera } from 'three';

export interface ScreenPosition {
  x: number;
  y: number;
  visible: boolean;
}

const scratch = new Vector3();

/** Projects a world point to pixel coordinates, with origin at the top left. */
export function projectToScreen(
  world: Vector3,
  camera: PerspectiveCamera,
  width: number,
  height: number,
): ScreenPosition {
  const projected = scratch.copy(world).project(camera);
  return {
    x: (projected.x * 0.5 + 0.5) * width,
    y: (-projected.y * 0.5 + 0.5) * height,
    visible: projected.z >= -1 && projected.z <= 1,
  };
}

export class Anchor {
  readonly element: HTMLDivElement;
  private readonly world = new Vector3();
  private active = true;

  constructor(label: string, world: Vector3, parent: HTMLElement) {
    this.world.copy(world);
    this.element = document.createElement('div');
    this.element.textContent = label;
    this.element.dataset['anchor'] = label;
    this.element.style.cssText = [
      'position:fixed',
      'pointer-events:none',
      'transform:translate(-50%,-50%)',
      'padding:2px 6px',
      'font:11px/1.4 ui-monospace,monospace',
      'letter-spacing:0.08em',
      'text-transform:uppercase',
      'color:#cfe3ff',
      'text-shadow:0 0 6px #000,0 0 2px #000',
      'white-space:nowrap',
      'z-index:10',
    ].join(';');
    parent.appendChild(this.element);
  }

  /** An inactive anchor stays off screen whatever the projection says. */
  setActive(active: boolean): void {
    this.active = active;
  }

  moveTo(x: number, y: number, z: number): void {
    this.world.set(x, y, z);
  }

  update(camera: PerspectiveCamera, width: number, height: number): void {
    if (!this.active) {
      this.element.hidden = true;
      return;
    }
    const position = projectToScreen(this.world, camera, width, height);
    this.element.hidden = !position.visible;
    if (!position.visible) return;
    this.element.style.left = `${position.x}px`;
    this.element.style.top = `${position.y}px`;
  }

  dispose(): void {
    this.element.remove();
  }
}
