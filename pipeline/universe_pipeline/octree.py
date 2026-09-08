"""Additive-refinement octree, following the Potree approach."""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass, field

import numpy as np

MAX_DEPTH = 24


@dataclass
class OctreeNode:
    path: str
    bbox_min: np.ndarray
    bbox_max: np.ndarray
    indices: np.ndarray
    geometric_error: float
    total_points: int
    children: list[OctreeNode] = field(default_factory=list)


def iter_nodes(root: OctreeNode) -> Iterator[OctreeNode]:
    """Depth-first, parents before children."""
    stack = [root]
    while stack:
        node = stack.pop()
        yield node
        stack.extend(reversed(node.children))


def _geometric_error(
    bbox_min: np.ndarray, bbox_max: np.ndarray, max_points_per_node: int
) -> float:
    """Approximate spacing between the points a node draws, from the budget, not the count."""
    diagonal = float(np.linalg.norm(bbox_max - bbox_min))
    return diagonal / max(max_points_per_node, 1) ** (1.0 / 3.0)


def _child_box(
    bbox_min: np.ndarray, bbox_max: np.ndarray, octant: int
) -> tuple[np.ndarray, np.ndarray]:
    centre = (bbox_min + bbox_max) * 0.5
    lo = np.where([(octant >> axis) & 1 for axis in range(3)], centre, bbox_min)
    hi = np.where([(octant >> axis) & 1 for axis in range(3)], bbox_max, centre)
    return lo.astype(np.float64), hi.astype(np.float64)


def _build(
    positions: np.ndarray,
    indices: np.ndarray,
    bbox_min: np.ndarray,
    bbox_max: np.ndarray,
    path: str,
    max_points_per_node: int,
    rng: np.random.Generator,
    depth: int,
) -> OctreeNode:
    total = int(indices.size)

    if total <= max_points_per_node or depth >= MAX_DEPTH:
        return OctreeNode(
            path=path,
            bbox_min=bbox_min,
            bbox_max=bbox_max,
            indices=indices.astype(np.uint32),
            geometric_error=_geometric_error(bbox_min, bbox_max, max_points_per_node),
            total_points=total,
        )

    shuffled = rng.permutation(indices)
    kept = shuffled[:max_points_per_node]
    remaining = shuffled[max_points_per_node:]

    centre = (bbox_min + bbox_max) * 0.5
    octants = (
        (positions[remaining, 0] >= centre[0]).astype(np.uint8)
        | ((positions[remaining, 1] >= centre[1]).astype(np.uint8) << 1)
        | ((positions[remaining, 2] >= centre[2]).astype(np.uint8) << 2)
    )

    children: list[OctreeNode] = []
    for octant in range(8):
        member = remaining[octants == octant]
        if member.size == 0:
            continue
        child_min, child_max = _child_box(bbox_min, bbox_max, octant)
        children.append(
            _build(
                positions, member, child_min, child_max,
                f"{path}{octant}", max_points_per_node, rng, depth + 1,
            )
        )

    return OctreeNode(
        path=path,
        bbox_min=bbox_min,
        bbox_max=bbox_max,
        indices=kept.astype(np.uint32),
        geometric_error=_geometric_error(bbox_min, bbox_max, max_points_per_node),
        total_points=total,
        children=children,
    )


def build_octree(
    positions: np.ndarray, max_points_per_node: int, seed: int = 0
) -> OctreeNode:
    if max_points_per_node <= 0:
        raise ValueError("max_points_per_node must be positive")

    positions = np.asarray(positions, dtype=np.float64)
    n = int(positions.shape[0])

    if n == 0:
        zero = np.zeros(3, dtype=np.float64)
        return OctreeNode(
            path="r",
            bbox_min=zero,
            bbox_max=zero.copy(),
            indices=np.zeros(0, dtype=np.uint32),
            geometric_error=0.0,
            total_points=0,
        )

    bbox_min = positions.min(axis=0)
    bbox_max = positions.max(axis=0)
    # Nudge degenerate axes so child boxes stay well defined.
    bbox_max = np.where(bbox_max > bbox_min, bbox_max, bbox_min + 1e-6)

    return _build(
        positions,
        np.arange(n, dtype=np.uint32),
        bbox_min,
        bbox_max,
        "r",
        max_points_per_node,
        np.random.default_rng(seed),
        depth=0,
    )
