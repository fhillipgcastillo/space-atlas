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

  constructor(
    label: string,
    private readonly world: Vector3,
    parent: HTMLElement,
  ) {
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

  update(camera: PerspectiveCamera, width: number, height: number): void {
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
