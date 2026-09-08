"""Writes the cross-language contract fixtures read by app/src/tiles/format.test.ts."""

import json
from pathlib import Path

import numpy as np
import pytest

from universe_pipeline.tileformat import HEADER_BYTES, TilePoints, encode_tile

FIXTURE_DIR = Path(__file__).resolve().parents[2] / "tests" / "fixtures"


def _make_fixture(n: int, seed: int) -> tuple[bytes, dict[str, object]]:
    rng = np.random.default_rng(seed)
    position = rng.uniform(-1000.0, 1000.0, size=(n, 3))
    points = TilePoints(
        position=position,
        velocity=rng.uniform(-40.0, 40.0, size=(n, 3)).astype(np.float32),
        color_index=rng.integers(0, 65535, size=n, dtype=np.uint16),
        abs_mag=rng.uniform(-5.0, 15.0, size=n).astype(np.float32),
        type_flags=rng.integers(0, 3, size=n, dtype=np.uint8),
        local_id=np.arange(n, dtype=np.uint32),
    )
    lo = position.min(axis=0)
    hi = position.max(axis=0)

    expected: dict[str, object] = {
        "pointCount": n,
        "bboxMin": lo.tolist(),
        "bboxMax": hi.tolist(),
        "position": points.position.tolist(),
        "velocity": points.velocity.astype(np.float16).astype(np.float64).tolist(),
        "colorIndex": points.color_index.tolist(),
        "absMag": points.abs_mag.astype(np.float16).astype(np.float64).tolist(),
        "typeFlags": points.type_flags.tolist(),
        "localId": points.local_id.tolist(),
    }
    return encode_tile(points, lo, hi), expected


@pytest.mark.parametrize(
    ("name", "n", "seed"),
    [
        ("contract-tile", 64, 20260908),
        ("contract-tile-odd", 63, 20260909),
    ],
)
def test_export_contract_fixture(name: str, n: int, seed: int) -> None:
    blob, expected = _make_fixture(n, seed)

    FIXTURE_DIR.mkdir(parents=True, exist_ok=True)
    (FIXTURE_DIR / f"{name}.bin").write_bytes(blob)
    (FIXTURE_DIR / f"{name}.json").write_text(json.dumps(expected), encoding="utf-8")

    assert (FIXTURE_DIR / f"{name}.bin").stat().st_size > HEADER_BYTES


def test_odd_fixture_actually_exercises_padding() -> None:
    n = 63
    block_lengths = [6 * n, 6 * n, 2 * n, 2 * n, 1 * n, 4 * n]
    padded_blocks = [length for length in block_lengths if length % 4 != 0]

    assert len(padded_blocks) == 5, (
        f"the odd fixture must force padding; N={n} pads {len(padded_blocks)} blocks"
    )

    blob, _ = _make_fixture(n, 20260909)
    assert len(blob) > HEADER_BYTES + sum(block_lengths)
