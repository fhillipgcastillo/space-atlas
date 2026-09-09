import { Vector3, type PerspectiveCamera } from 'three';
import { projectToScreen } from './anchors.js';

export interface LabelCandidate {
  text: string;
  screenX: number;
  screenY: number;
  priority: number;
}

/** Pixel size of the box a label is assumed to occupy, centred on its point. */
export interface BoxSize {
  width: number;
  height: number;
}

export interface NamedObject {
  name: string;
  position: readonly [number, number, number];
  /** Metres in one unit of the layer `position` is expressed in. */
  unitInMetres: number;
  absMag?: number;
}

const MIN_DISTANCE_METRES = 1e-9;

/** Negative apparent magnitude: nearer and brighter both raise it. */
export function labelPriority(distanceMetres: number, absMag = 0): number {
  return -(absMag + 5 * Math.log10(Math.max(distanceMetres, MIN_DISTANCE_METRES)));
}

// Boxes are axis-aligned and centred on the point, matching how LabelLayer
// positions its elements. Touching exactly at an edge is not an overlap, so a
// separation of exactly boxSize.width keeps both labels.
function overlaps(a: LabelCandidate, b: LabelCandidate, boxSize: BoxSize): boolean {
  return (
    Math.abs(a.screenX - b.screenX) < boxSize.width &&
    Math.abs(a.screenY - b.screenY) < boxSize.height
  );
}

export function declutter(
  candidates: readonly LabelCandidate[],
  boxSize: BoxSize,
  maxLabels: number,
): LabelCandidate[] {
  if (maxLabels <= 0) return [];

  const ordered = candidates
    .map((candidate, index) => ({ candidate, index }))
    // An unnamed object must never be labelled; nothing upstream can smuggle
    // one through as blank text.
    .filter(({ candidate }) => candidate.text.trim() !== '')
    .sort((a, b) => b.candidate.priority - a.candidate.priority || a.index - b.index);

  const placed: LabelCandidate[] = [];
  for (const { candidate } of ordered) {
    if (placed.length >= maxLabels) break;
    if (placed.some((other) => overlaps(candidate, other, boxSize))) continue;
    placed.push(candidate);
  }
  return placed;
}

const world = new Vector3();

// Candidates come from the named-object index only. Modeled points carry no
// name and never enter that index, so they cannot be labelled by construction.
export function buildCandidates(
  objects: Iterable<NamedObject>,
  camera: PerspectiveCamera,
  width: number,
  height: number,
  activeUnitInMetres: number,
): LabelCandidate[] {
  const candidates: LabelCandidate[] = [];
  for (const object of objects) {
    const text = object.name.trim();
    if (text === '') continue;

    const scale = object.unitInMetres / activeUnitInMetres;
    world.set(
      object.position[0] * scale,
      object.position[1] * scale,
      object.position[2] * scale,
    );
    const screen = projectToScreen(world, camera, width, height);
    if (!screen.visible) continue;
    if (screen.x < 0 || screen.x > width || screen.y < 0 || screen.y > height) continue;

    const distanceMetres = world.distanceTo(camera.position) * activeUnitInMetres;
    candidates.push({
      text,
      screenX: screen.x,
      screenY: screen.y,
      priority: labelPriority(distanceMetres, object.absMag),
    });
  }
  return candidates;
}

export class LabelLayer {
  private readonly elements: HTMLDivElement[] = [];
  private visible = true;

  constructor(private readonly parent: HTMLElement) {}

  isVisible(): boolean {
    return this.visible;
  }

  setVisible(visible: boolean): void {
    if (visible === this.visible) return;
    this.visible = visible;
    if (!visible) this.hideAll();
  }

  // Elements are pooled and reused. Rebuilding dozens of nodes every frame is a
  // real cost at the frame rates software rendering reaches.
  update(placed: readonly LabelCandidate[]): void {
    if (!this.visible) {
      this.hideAll();
      return;
    }
    for (let i = 0; i < placed.length; i++) {
      const label = placed[i]!;
      const element = this.elements[i] ?? this.create();
      if (element.textContent !== label.text) element.textContent = label.text;
      element.style.transform = `translate(-50%,-50%) translate(${label.screenX.toFixed(1)}px,${label.screenY.toFixed(1)}px)`;
      element.hidden = false;
    }
    for (let i = placed.length; i < this.elements.length; i++) {
      this.elements[i]!.hidden = true;
    }
  }

  dispose(): void {
    for (const element of this.elements) element.remove();
    this.elements.length = 0;
  }

  private hideAll(): void {
    for (const element of this.elements) element.hidden = true;
  }

  private create(): HTMLDivElement {
    const element = document.createElement('div');
    element.setAttribute('data-testid', 'auto-label');
    element.style.cssText = [
      'position:fixed',
      'left:0',
      'top:0',
      'pointer-events:none',
      'padding:1px 4px',
      'font:10px/1.4 ui-monospace,monospace',
      'color:#dbe8ff',
      'text-shadow:0 0 6px #000,0 0 2px #000',
      'white-space:nowrap',
      'z-index:9',
    ].join(';');
    this.parent.appendChild(element);
    this.elements.push(element);
    return element;
  }
}
