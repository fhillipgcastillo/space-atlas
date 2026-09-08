"""Tile format v1 codec. See docs/tile-format.md — this file is a contract."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

TILE_MAGIC = b"UMT1"
TILE_VERSION = 1
HEADER_BYTES = 64
ATTRIBUTE_MASK_V1 = 0x3F
QUANT_MAX = 65535


@dataclass
class TilePoints:
    """Per-point attributes for one tile, in layer units."""

    position: np.ndarray  # float64 (N, 3)
    velocity: np.ndarray  # float32 (N, 3), km/s
    color_index: np.ndarray  # uint16 (N,)
    abs_mag: np.ndarray  # float32 (N,)
    type_flags: np.ndarray  # uint8 (N,)
    local_id: np.ndarray  # uint32 (N,)

    def __len__(self) -> int:
        return int(self.position.shape[0])


def _pad_to_4(buf: bytearray) -> None:
    while len(buf) % 4:
        buf.append(0)


def quantize_positions(
    position: np.ndarray, bbox_min: np.ndarray, bbox_max: np.ndarray
) -> np.ndarray:
    """Map positions onto the tile bounding box as uint16 fractions."""
    extent = bbox_max - bbox_min
    safe = np.where(extent > 0.0, extent, 1.0)
    frac = (position - bbox_min) / safe
    frac = np.where(extent > 0.0, frac, 0.0)
    return np.rint(np.clip(frac, 0.0, 1.0) * QUANT_MAX).astype(np.uint16)


def dequantize_positions(
    quantized: np.ndarray, bbox_min: np.ndarray, bbox_max: np.ndarray
) -> np.ndarray:
    extent = bbox_max - bbox_min
    return bbox_min + (quantized.astype(np.float64) / QUANT_MAX) * extent


def encode_tile(points: TilePoints, bbox_min: np.ndarray, bbox_max: np.ndarray) -> bytes:
    n = len(points)
    lo = np.asarray(bbox_min, dtype=np.float64)
    hi = np.asarray(bbox_max, dtype=np.float64)

    out = bytearray()
    out += TILE_MAGIC
    out += np.array([TILE_VERSION, n, ATTRIBUTE_MASK_V1], dtype="<u4").tobytes()
    out += lo.astype("<f8").tobytes()
    out += hi.astype("<f8").tobytes()
    assert len(out) == HEADER_BYTES, f"header is {len(out)} bytes, expected {HEADER_BYTES}"

    for block in (
        quantize_positions(points.position, lo, hi).astype("<u2"),
        points.velocity.astype("<f2"),
        points.color_index.astype("<u2"),
        points.abs_mag.astype("<f2"),
        points.type_flags.astype("u1"),
        points.local_id.astype("<u4"),
    ):
        out += block.tobytes()
        _pad_to_4(out)

    return bytes(out)


def _take(blob: bytes, offset: int, dtype: str, count: int) -> tuple[np.ndarray, int]:
    arr = np.frombuffer(blob, dtype=dtype, count=count, offset=offset)
    end = offset + arr.nbytes
    return arr, end + (-end % 4)


def decode_tile(blob: bytes) -> tuple[TilePoints, np.ndarray, np.ndarray]:
    if blob[0:4] != TILE_MAGIC:
        raise ValueError(f"bad tile magic: {blob[0:4]!r}")
    version, n, _mask = np.frombuffer(blob, dtype="<u4", count=3, offset=4)
    if int(version) != TILE_VERSION:
        raise ValueError(f"unsupported tile format version {int(version)}")
    n = int(n)

    lo = np.frombuffer(blob, dtype="<f8", count=3, offset=16).copy()
    hi = np.frombuffer(blob, dtype="<f8", count=3, offset=40).copy()

    off = HEADER_BYTES
    quant, off = _take(blob, off, "<u2", n * 3)
    velocity, off = _take(blob, off, "<f2", n * 3)
    color_index, off = _take(blob, off, "<u2", n)
    abs_mag, off = _take(blob, off, "<f2", n)
    type_flags, off = _take(blob, off, "u1", n)
    local_id, off = _take(blob, off, "<u4", n)

    points = TilePoints(
        position=dequantize_positions(quant.reshape(n, 3), lo, hi),
        velocity=velocity.reshape(n, 3).astype(np.float32),
        color_index=color_index.copy(),
        abs_mag=abs_mag.astype(np.float32),
        type_flags=type_flags.copy(),
        local_id=local_id.copy(),
    )
    return points, lo, hi
