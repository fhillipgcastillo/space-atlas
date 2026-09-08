import numpy as np
import pytest

from universe_pipeline.tileformat import (
    HEADER_BYTES,
    TILE_MAGIC,
    TILE_VERSION,
    TilePoints,
    decode_tile,
    encode_tile,
)


def make_points(n: int, rng: np.random.Generator) -> TilePoints:
    return TilePoints(
        position=rng.uniform(-100.0, 100.0, size=(n, 3)),
        velocity=rng.uniform(-50.0, 50.0, size=(n, 3)).astype(np.float32),
        color_index=rng.integers(0, 65535, size=n, dtype=np.uint16),
        abs_mag=rng.uniform(-5.0, 15.0, size=n).astype(np.float32),
        type_flags=rng.integers(0, 255, size=n, dtype=np.uint8),
        local_id=rng.integers(0, 2**31, size=n, dtype=np.uint32),
    )


def test_header_is_well_formed() -> None:
    rng = np.random.default_rng(0)
    pts = make_points(10, rng)
    lo = pts.position.min(axis=0)
    hi = pts.position.max(axis=0)

    blob = encode_tile(pts, lo, hi)

    assert blob[0:4] == TILE_MAGIC
    assert int(np.frombuffer(blob[4:8], dtype="<u4")[0]) == TILE_VERSION
    assert int(np.frombuffer(blob[8:12], dtype="<u4")[0]) == 10
    assert len(blob) > HEADER_BYTES


def test_round_trip_preserves_values_within_quantization_error() -> None:
    rng = np.random.default_rng(1)
    pts = make_points(5000, rng)
    lo = pts.position.min(axis=0)
    hi = pts.position.max(axis=0)

    decoded, dec_lo, dec_hi = decode_tile(encode_tile(pts, lo, hi))

    np.testing.assert_allclose(dec_lo, lo)
    np.testing.assert_allclose(dec_hi, hi)

    # Positions are lossy by design; bound the error at half a quantization step.
    tolerance = (hi - lo) / 131070.0
    assert np.all(np.abs(decoded.position - pts.position) <= tolerance + 1e-9)

    # Exact types survive exactly.
    np.testing.assert_array_equal(decoded.color_index, pts.color_index)
    np.testing.assert_array_equal(decoded.type_flags, pts.type_flags)
    np.testing.assert_array_equal(decoded.local_id, pts.local_id)

    # float16 keeps roughly three decimal digits.
    np.testing.assert_allclose(decoded.velocity, pts.velocity, rtol=1e-2, atol=1e-2)
    np.testing.assert_allclose(decoded.abs_mag, pts.abs_mag, rtol=1e-2, atol=1e-2)


def test_degenerate_axis_round_trips_to_the_bound() -> None:
    pts = make_points(4, np.random.default_rng(2))
    pts.position[:, 2] = 7.5
    lo = pts.position.min(axis=0)
    hi = pts.position.max(axis=0)
    assert lo[2] == hi[2]

    decoded, _, _ = decode_tile(encode_tile(pts, lo, hi))

    np.testing.assert_allclose(decoded.position[:, 2], 7.5)


def test_empty_tile_round_trips() -> None:
    pts = make_points(0, np.random.default_rng(3))
    lo = np.zeros(3)
    hi = np.ones(3)

    decoded, _, _ = decode_tile(encode_tile(pts, lo, hi))

    assert decoded.position.shape == (0, 3)


def test_rejects_wrong_magic() -> None:
    rng = np.random.default_rng(4)
    pts = make_points(3, rng)
    blob = bytearray(encode_tile(pts, pts.position.min(axis=0), pts.position.max(axis=0)))
    blob[0:4] = b"XXXX"

    with pytest.raises(ValueError, match="magic"):
        decode_tile(bytes(blob))
