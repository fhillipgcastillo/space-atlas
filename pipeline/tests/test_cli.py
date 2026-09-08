import time
from pathlib import Path

import numpy as np
import pytest

from universe_pipeline.cli import HEALPIX8_TOTAL, fetch_layer_chunks
from universe_pipeline.config import L1_STELLAR_NEIGHBOURHOOD as L1


def fake_table(marker: float) -> dict[str, np.ndarray]:
    one = np.array([marker])
    return {
        "source_id": np.array([int(marker)], dtype=np.uint64),
        "ra": np.array([10.0]),
        "dec": np.array([20.0]),
        "parallax": np.array([10.0]),
        "parallax_over_error": np.array([50.0]),
        "pmra": np.array([0.0]),
        "pmdec": np.array([0.0]),
        "radial_velocity": np.array([0.0]),
        "phot_g_mean_mag": np.array([8.0]),
        "bp_rp": np.array([0.5]),
        "r_med_geo": one * 0 + 100.0,
    }


def test_results_follow_chunk_order_regardless_of_completion_order() -> None:
    # Later chunks finish first, so any reliance on completion order shows up.
    def fetch(_layer: object, lo: int, _hi: int, _cache: Path) -> dict[str, np.ndarray]:
        time.sleep(0.05 if lo == 0 else 0.0)
        return fake_table(float(lo + 1))

    parts = fetch_layer_chunks(L1, chunks=4, cache_dir=Path("unused"), workers=4, fetch=fetch)

    edges = np.linspace(0, HEALPIX8_TOTAL, 5, dtype=int)
    assert [int(p.catalog_id[0]) for p in parts] == [int(e) + 1 for e in edges[:4]]


def test_every_chunk_is_fetched_exactly_once() -> None:
    seen: list[int] = []

    def fetch(_layer: object, lo: int, _hi: int, _cache: Path) -> dict[str, np.ndarray]:
        seen.append(lo)
        return fake_table(float(lo + 1))

    fetch_layer_chunks(L1, chunks=8, cache_dir=Path("unused"), workers=4, fetch=fetch)

    assert len(seen) == 8
    assert len(set(seen)) == 8


def test_chunk_ranges_tile_the_whole_sky_without_gaps_or_overlap() -> None:
    spans: list[tuple[int, int]] = []

    def fetch(_layer: object, lo: int, hi: int, _cache: Path) -> dict[str, np.ndarray]:
        spans.append((lo, hi))
        return fake_table(float(lo + 1))

    fetch_layer_chunks(L1, chunks=6, cache_dir=Path("unused"), workers=3, fetch=fetch)

    spans.sort()
    assert spans[0][0] == 0
    assert spans[-1][1] == HEALPIX8_TOTAL - 1
    for (_, prev_hi), (next_lo, _) in zip(spans, spans[1:], strict=False):
        assert next_lo == prev_hi + 1


def test_a_failing_chunk_surfaces_rather_than_silently_shrinking_the_layer() -> None:
    def fetch(_layer: object, lo: int, _hi: int, _cache: Path) -> dict[str, np.ndarray]:
        if lo != 0:
            raise RuntimeError("archive rejected the query")
        return fake_table(1.0)

    with pytest.raises(RuntimeError, match="archive"):
        fetch_layer_chunks(L1, chunks=4, cache_dir=Path("unused"), workers=2, fetch=fetch)


def test_single_worker_still_works() -> None:
    parts = fetch_layer_chunks(
        L1, chunks=3, cache_dir=Path("unused"), workers=1,
        fetch=lambda _l, lo, _h, _c: fake_table(float(lo + 1)),
    )
    assert len(parts) == 3
