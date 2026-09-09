import type { TileNode } from './tileset.js';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface ViewState {
  position: Vec3;
  screenHeight: number;
  fovRadians: number;
}

export function distanceToBox(point: Vec3, min: number[], max: number[]): number {
  const dx = Math.max(min[0]! - point.x, 0, point.x - max[0]!);
  const dy = Math.max(min[1]! - point.y, 0, point.y - max[1]!);
  const dz = Math.max(min[2]! - point.z, 0, point.z - max[2]!);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** Projected size, in pixels, of this node's point spacing. */
export function screenSpaceError(
  geometricError: number,
  distance: number,
  screenHeight: number,
  fovRadians: number,
): number {
  // A node with no measurable extent has no detail to gain by refining, and a
  // NaN here would sink to the back of every priority comparison and stall the
  // queue. Both cases collapse to the lowest possible error.
  if (!(geometricError > 0)) return 0;
  if (Number.isNaN(distance)) return 0;
  if (distance <= 0) return Infinity;
  return (geometricError * screenHeight) / (2 * distance * Math.tan(fovRadians / 2));
}

export function nodeScreenSpaceError(node: TileNode, view: ViewState): number {
  return screenSpaceError(
    node.geometricError,
    distanceToBox(view.position, node.boundingBox.min, node.boundingBox.max),
    view.screenHeight,
    view.fovRadians,
  );
}

interface Candidate {
  node: TileNode;
  error: number;
}

export interface SelectedNode {
  node: TileNode;
  fluxWeight: number;
}

/**
 * Selects nodes to draw. Refinement is additive: selecting a child does not
 * deselect its parent, because a parent holds points its children do not.
 */
export function selectNodesWithFlux(
  root: TileNode,
  view: ViewState,
  threshold: number,
  maxNodes: number,
): SelectedNode[] {
  const selected: TileNode[] = [];
  const frontier: Candidate[] = [{ node: root, error: nodeScreenSpaceError(root, view) }];

  while (frontier.length > 0 && selected.length < maxNodes) {
    let bestIndex = 0;
    for (let i = 1; i < frontier.length; i++) {
      if (frontier[i]!.error > frontier[bestIndex]!.error) bestIndex = i;
    }
    const [candidate] = frontier.splice(bestIndex, 1);
    if (!candidate) break;

    selected.push(candidate.node);
    if (candidate.error <= threshold) continue;

    for (const child of candidate.node.children) {
      frontier.push({ node: child, error: nodeScreenSpaceError(child, view) });
    }
  }

  const chosen = new Set(selected.map((node) => node.path));
  return selected.map((node) => {
    // Everything at and beneath the node, less the parts a selected child now
    // draws itself. Subtracting rather than adding also covers the points a
    // node stands in for that are not in its `children` at all.
    let represented = node.totalPointCount;
    for (const child of node.children) {
      if (chosen.has(child.path)) represented -= child.totalPointCount;
    }
    const drawn = node.pointCount;
    return { node, fluxWeight: drawn > 0 ? Math.max(represented / drawn, 1) : 1 };
  });
}

export function selectNodes(
  root: TileNode,
  view: ViewState,
  threshold: number,
  maxNodes: number,
): TileNode[] {
  return selectNodesWithFlux(root, view, threshold, maxNodes).map((s) => s.node);
}
