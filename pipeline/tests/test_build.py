import json
from pathlib import Path

import numpy as np

from universe_pipeline.build import build_layer
from universe_pipeline.config import L1_STELLAR_NEIGHBOURHOOD
from universe_pipeline.records import CLASS_STAR, ObjectRecord, pack_type
from universe_pipeline.tileformat import decode_tile


def synthetic_record(n: int, seed: int = 3) -> ObjectRecord:
    rng = np.random.default_rng(seed)
    direction = rng.normal(size=(n, 3))
    direction /= np.linalg.norm(direction, axis=1, keepdims=True)
    radius = rng.uniform(1.0, 4000.0, size=(n, 1))
    return ObjectRecord(
        position_ly=direction * radius,
        velocity_km_s=rng.uniform(-40.0, 40.0, size=(n, 3)).astype(np.float32),
        abs_mag=rng.uniform(-5.0, 15.0, size=n).astype(np.float32),
        colour_index=rng.integers(0, 65535, size=n, dtype=np.uint16),
        type_flags=np.full(n, pack_type(CLASS_STAR), dtype=np.uint8),
        catalog_id=np.arange(1000, 1000 + n, dtype=np.uint64),
    )


def test_build_writes_a_tileset_and_every_referenced_tile(tmp_path: Path) -> None:
    record = synthetic_record(8_000)
    tileset = build_layer(record, L1_STELLAR_NEIGHBOURHOOD, tmp_path)

    written = json.loads((tmp_path / "stellar-neighbourhood" / "tileset.json").read_text())
    assert written == tileset
    assert written["formatVersion"] == 1
    assert written["unit"] == "ly"
    assert written["pointCount"] == 8_000

    def check(node: dict) -> int:
        blob = (tmp_path / "stellar-neighbourhood" / f"{node['path']}.bin").read_bytes()
        points, lo, hi = decode_tile(blob)
        assert len(points) == node["pointCount"]
        np.testing.assert_allclose(lo, node["boundingBox"]["min"])
        np.testing.assert_allclose(hi, node["boundingBox"]["max"])
        return len(points) + sum(check(child) for child in node["children"])

    assert check(written["root"]) == 8_000


def test_identifier_table_maps_local_ids_back_to_catalog_ids(tmp_path: Path) -> None:
    record = synthetic_record(2_000)
    build_layer(record, L1_STELLAR_NEIGHBOURHOOD, tmp_path)

    ids = np.fromfile(tmp_path / "stellar-neighbourhood" / "ids.bin", dtype="<u8")
    assert ids.size == 2_000

    blob = (tmp_path / "stellar-neighbourhood" / "r.bin").read_bytes()
    points, _, _ = decode_tile(blob)
    assert np.all(points.local_id < ids.size)
    np.testing.assert_array_equal(ids[points.local_id], record.catalog_id[points.local_id])


def test_positions_survive_the_round_trip_within_quantization_error(tmp_path: Path) -> None:
    record = synthetic_record(4_000)
    tileset = build_layer(record, L1_STELLAR_NEIGHBOURHOOD, tmp_path)

    def walk(node: dict) -> None:
        points, lo, hi = decode_tile(
            (tmp_path / "stellar-neighbourhood" / f"{node['path']}.bin").read_bytes()
        )
        tolerance = (np.asarray(hi) - np.asarray(lo)) / 131070.0 + 1e-9
        original = record.position_ly[points.local_id]
        assert np.all(np.abs(points.position - original) <= tolerance)
        for child in node["children"]:
            walk(child)

    walk(tileset["root"])


def test_empty_record_produces_a_valid_empty_tileset(tmp_path: Path) -> None:
    tileset = build_layer(synthetic_record(0), L1_STELLAR_NEIGHBOURHOOD, tmp_path)
    assert tileset["pointCount"] == 0
    assert (tmp_path / "stellar-neighbourhood" / "r.bin").exists()


def test_rebake_removes_tiles_from_a_previous_run(tmp_path: Path) -> None:
    build_layer(synthetic_record(6_000), L1_STELLAR_NEIGHBOURHOOD, tmp_path)
    layer_dir = tmp_path / "stellar-neighbourhood"
    orphan = layer_dir / "r7777.bin"
    orphan.write_bytes(b"stale")

    tileset = build_layer(synthetic_record(200), L1_STELLAR_NEIGHBOURHOOD, tmp_path)

    assert not orphan.exists()
    referenced = set()
    stack = [tileset["root"]]
    while stack:
        node = stack.pop()
        referenced.add(f"{node['path']}.bin")
        stack.extend(node["children"])
    on_disk = {p.name for p in layer_dir.glob("*.bin")} - {"ids.bin"}
    assert on_disk == referenced


def test_names_are_written_in_local_id_order(tmp_path: Path) -> None:
    record = synthetic_record(5)
    names = [f"body {i}" for i in range(5)]

    build_layer(record, L1_STELLAR_NEIGHBOURHOOD, tmp_path, names=names)

    written = json.loads(
        (tmp_path / "stellar-neighbourhood" / "names.json").read_text(encoding="utf-8")
    )
    assert written["3"] == "body 3"
    assert len(written) == 5


def test_no_names_file_when_none_are_supplied(tmp_path: Path) -> None:
    build_layer(synthetic_record(5), L1_STELLAR_NEIGHBOURHOOD, tmp_path)
    assert not (tmp_path / "stellar-neighbourhood" / "names.json").exists()


def test_tileset_records_the_origin_and_identifier_prefix(tmp_path: Path) -> None:
    tileset = build_layer(synthetic_record(3), L1_STELLAR_NEIGHBOURHOOD, tmp_path)
    assert tileset["origin"] == L1_STELLAR_NEIGHBOURHOOD.origin
    assert "idPrefix" in tileset
