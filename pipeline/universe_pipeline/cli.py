"""Command-line entry point for baking layer tiles."""

from __future__ import annotations

import argparse
import sys
from collections.abc import Callable, Mapping
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np

from universe_pipeline.build import build_layer
from universe_pipeline.config import L1_STELLAR_NEIGHBOURHOOD, LayerConfig
from universe_pipeline.records import TYPE_STAR, ObjectRecord
from universe_pipeline.sources.gaia import fetch_gaia_chunk, normalise_gaia

LAYERS: dict[str, LayerConfig] = {
    L1_STELLAR_NEIGHBOURHOOD.key: L1_STELLAR_NEIGHBOURHOOD,
}

# Gaia source_id encodes HEALPix level 12; chunking the level-8 index range
# keeps every archive job under the row limit and makes the download resumable.
HEALPIX8_TOTAL = 12 * 4**8


def _synthetic(count: int, layer: LayerConfig, seed: int) -> ObjectRecord:
    rng = np.random.default_rng(seed)
    direction = rng.normal(size=(count, 3))
    direction /= np.linalg.norm(direction, axis=1, keepdims=True)
    radius = layer.max_radius_ly * rng.uniform(0.0, 1.0, size=(count, 1)) ** (1 / 3)
    return ObjectRecord(
        position_ly=direction * np.maximum(radius, layer.min_radius_ly),
        velocity_km_s=rng.normal(0.0, 30.0, size=(count, 3)).astype(np.float32),
        abs_mag=rng.normal(4.0, 3.0, size=count).astype(np.float32),
        colour_index=rng.integers(0, 65535, size=count, dtype=np.uint16),
        type_flags=np.full(count, TYPE_STAR, dtype=np.uint8),
        catalog_id=np.arange(count, dtype=np.uint64),
    )


FetchFn = Callable[[LayerConfig, int, int, Path], Mapping[str, np.ndarray]]


def fetch_layer_chunks(
    layer: LayerConfig,
    chunks: int,
    cache_dir: Path,
    workers: int,
    fetch: FetchFn = fetch_gaia_chunk,
) -> list[ObjectRecord]:
    """Fetch and normalise every sky chunk, returned in chunk order."""
    # Time is spent in the archive executing queries, not transferring rows, so
    # the run is bound by how many queries are in flight rather than bandwidth.
    edges = np.linspace(0, HEALPIX8_TOTAL, chunks + 1, dtype=int)
    results: list[ObjectRecord | None] = [None] * chunks
    done = 0

    def one(index: int) -> tuple[int, ObjectRecord]:
        table = fetch(layer, int(edges[index]), int(edges[index + 1]) - 1, cache_dir)
        return index, normalise_gaia(table, layer)

    with ThreadPoolExecutor(max_workers=max(workers, 1)) as pool:
        for index, part in pool.map(one, range(chunks)):
            results[index] = part
            done += 1
            print(f"chunk {done}/{chunks}: {len(part)} sources", flush=True)

    return [part for part in results if part is not None]


def _concat(records: list[ObjectRecord]) -> ObjectRecord:
    return ObjectRecord(
        position_ly=np.concatenate([r.position_ly for r in records]),
        velocity_km_s=np.concatenate([r.velocity_km_s for r in records]),
        abs_mag=np.concatenate([r.abs_mag for r in records]),
        colour_index=np.concatenate([r.colour_index for r in records]),
        type_flags=np.concatenate([r.type_flags for r in records]),
        catalog_id=np.concatenate([r.catalog_id for r in records]),
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="universe-pipeline")
    parser.add_argument("--layer", default=L1_STELLAR_NEIGHBOURHOOD.key, choices=sorted(LAYERS))
    parser.add_argument("--out", type=Path, default=Path("public/data"))
    parser.add_argument("--cache", type=Path, default=Path("data/cache"))
    parser.add_argument(
        "--synthetic",
        type=int,
        metavar="COUNT",
        help="skip Gaia and bake COUNT deterministic placeholder stars",
    )
    parser.add_argument("--chunks", type=int, default=48, help="number of Gaia sky chunks")
    parser.add_argument("--workers", type=int, default=6, help="concurrent archive queries")
    args = parser.parse_args(argv)

    layer = LAYERS[args.layer]

    if args.synthetic is not None:
        record = _synthetic(args.synthetic, layer, seed=1)
        print(f"synthetic: {len(record)} placeholder stars")
    else:
        parts = fetch_layer_chunks(layer, args.chunks, args.cache, args.workers)
        record = _concat(parts)
        print(f"gaia: {len(record)} sources total")

    tileset = build_layer(record, layer, args.out)
    tiles = 0
    stack = [tileset["root"]]
    while stack:
        node = stack.pop()
        tiles += 1
        stack.extend(node["children"])
    print(f"wrote {tiles} tiles to {args.out / layer.key}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
