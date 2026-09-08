"""Wires normalized records through the octree into tiles on disk."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import numpy as np

from universe_pipeline.config import LayerConfig
from universe_pipeline.octree import OctreeNode, build_octree
from universe_pipeline.records import ObjectRecord
from universe_pipeline.tileformat import TilePoints, encode_tile

# Task 11 packs the vertex index into 20 bits of the pick identifier.
MAX_POINTS_PER_TILE_HARD_LIMIT = 1 << 20


def _node_to_json(node: OctreeNode) -> dict[str, Any]:
    return {
        "path": node.path,
        "boundingBox": {
            "min": node.bbox_min.tolist(),
            "max": node.bbox_max.tolist(),
        },
        "geometricError": node.geometric_error,
        "pointCount": int(node.indices.size),
        "totalPointCount": node.total_points,
        "children": [_node_to_json(child) for child in node.children],
    }


def _write_tiles(record: ObjectRecord, node: OctreeNode, out_dir: Path) -> None:
    idx = node.indices
    if idx.size > MAX_POINTS_PER_TILE_HARD_LIMIT:
        raise ValueError(
            f"node {node.path} holds {idx.size} points, above the "
            f"{MAX_POINTS_PER_TILE_HARD_LIMIT} the pick encoding can address"
        )
    points = TilePoints(
        position=record.position_ly[idx],
        velocity=record.velocity_km_s[idx],
        color_index=record.colour_index[idx],
        abs_mag=record.abs_mag[idx],
        type_flags=record.type_flags[idx],
        local_id=idx.astype(np.uint32),
    )
    (out_dir / f"{node.path}.bin").write_bytes(
        encode_tile(points, node.bbox_min, node.bbox_max)
    )
    for child in node.children:
        _write_tiles(record, child, out_dir)


def build_layer(record: ObjectRecord, layer: LayerConfig, out_dir: Path) -> dict[str, Any]:
    layer_dir = out_dir / layer.key
    layer_dir.mkdir(parents=True, exist_ok=True)

    root = build_octree(record.position_ly, layer.max_points_per_tile)
    _write_tiles(record, root, layer_dir)

    record.catalog_id.astype("<u8").tofile(layer_dir / "ids.bin")

    tileset: dict[str, Any] = {
        "formatVersion": 1,
        "layer": layer.key,
        "unit": layer.unit,
        "unitInMetres": layer.unit_in_metres,
        "frame": "galactic",
        "origin": "Sol",
        "pointCount": len(record),
        "root": _node_to_json(root),
    }
    (layer_dir / "tileset.json").write_text(json.dumps(tileset, indent=2), encoding="utf-8")
    return tileset
