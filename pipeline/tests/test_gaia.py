import numpy as np
import pytest

from universe_pipeline.config import L1_STELLAR_NEIGHBOURHOOD
from universe_pipeline.records import (
    CLASS_STAR,
    FLAG_MODELED,
    FLAG_NO_RADIAL_VELOCITY,
    object_class,
)
from universe_pipeline.sources.gaia import (
    BP_RP_NEUTRAL,
    _column_to_array,
    build_gaia_adql,
    normalise_gaia,
)


def sample_table(**overrides: np.ndarray) -> dict[str, np.ndarray]:
    table = {
        "source_id": np.array([1, 2, 3], dtype=np.uint64),
        "ra": np.array([266.40510, 10.0, 200.0]),
        "dec": np.array([-28.93617, 20.0, -40.0]),
        "parallax": np.array([10.0, 1.0, 0.5]),
        "parallax_over_error": np.array([50.0, 20.0, 1.0]),
        "pmra": np.array([0.0, 5.0, -3.0]),
        "pmdec": np.array([0.0, -2.0, 4.0]),
        "radial_velocity": np.array([0.0, np.nan, 12.0]),
        "phot_g_mean_mag": np.array([8.0, 12.0, 14.0]),
        "bp_rp": np.array([0.5, 1.8, np.nan]),
        "r_med_geo": np.array([100.0, 1000.0, np.nan]),
    }
    table.update(overrides)
    return table


def test_drops_sources_failing_the_parallax_quality_cut() -> None:
    record = normalise_gaia(sample_table(), L1_STELLAR_NEIGHBOURHOOD)
    assert len(record) == 2
    assert list(record.catalog_id) == [1, 2]


def test_prefers_bailer_jones_distance_over_parallax_inversion() -> None:
    # 250 pc disagrees with the 100 pc naive inversion on purpose.
    table = sample_table(r_med_geo=np.array([250.0, 1000.0, np.nan]))
    record = normalise_gaia(table, L1_STELLAR_NEIGHBOURHOOD)
    distance_ly = float(np.linalg.norm(record.position_ly[0]))
    assert distance_ly == pytest.approx(250.0 * 3.261563777167433, rel=1e-6)


def test_places_the_galactic_centre_direction_on_positive_x() -> None:
    record = normalise_gaia(sample_table(), L1_STELLAR_NEIGHBOURHOOD)
    unit = record.position_ly[0] / np.linalg.norm(record.position_ly[0])
    np.testing.assert_allclose(unit, np.array([1.0, 0.0, 0.0]), atol=1e-5)


def test_missing_radial_velocity_becomes_zero_not_nan() -> None:
    record = normalise_gaia(sample_table(), L1_STELLAR_NEIGHBOURHOOD)
    assert np.all(np.isfinite(record.velocity_km_s))


def test_drops_sources_beyond_the_layer_radius() -> None:
    table = sample_table(r_med_geo=np.array([100.0, 9_000_000.0, np.nan]))
    record = normalise_gaia(table, L1_STELLAR_NEIGHBOURHOOD)
    assert len(record) == 1


def test_all_records_are_measured_stars() -> None:
    record = normalise_gaia(sample_table(), L1_STELLAR_NEIGHBOURHOOD)
    assert np.all(object_class(record.type_flags) == CLASS_STAR)
    assert not np.any(record.type_flags & FLAG_MODELED)


def test_absolute_magnitude_uses_the_distance_modulus() -> None:
    table = sample_table(
        phot_g_mean_mag=np.array([10.0, 12.0, 14.0]),
        r_med_geo=np.array([100.0, 1000.0, np.nan]),
    )
    record = normalise_gaia(table, L1_STELLAR_NEIGHBOURHOOD)
    # M = m - 5*log10(d_pc) + 5 => 10 - 10 + 5 = 5
    assert float(record.abs_mag[0]) == pytest.approx(5.0, abs=1e-4)


def test_missing_colour_falls_back_to_the_neutral_index() -> None:
    # Source 2 clears the quality cuts; source 3 is dropped before the colour code.
    missing = normalise_gaia(
        sample_table(bp_rp=np.array([0.5, np.nan, 1.0])), L1_STELLAR_NEIGHBOURHOOD
    )
    explicit = normalise_gaia(
        sample_table(bp_rp=np.array([0.5, BP_RP_NEUTRAL, 1.0])), L1_STELLAR_NEIGHBOURHOOD
    )

    assert int(missing.colour_index[1]) == int(explicit.colour_index[1])
    assert int(missing.colour_index[1]) > 0


def test_column_to_array_accepts_a_plain_unmasked_column() -> None:
    from astropy.table import Column

    result = _column_to_array(Column([1.0, 2.0, 3.0], name="parallax"))

    np.testing.assert_array_equal(result, [1.0, 2.0, 3.0])


def test_column_to_array_turns_masked_float_gaps_into_nan() -> None:
    from astropy.table import MaskedColumn

    result = _column_to_array(
        MaskedColumn([1.0, 2.0, 3.0], mask=[False, True, False], name="radial_velocity")
    )

    assert result[0] == 1.0
    assert np.isnan(result[1])
    assert result[2] == 3.0


def test_column_to_array_preserves_large_source_ids_exactly() -> None:
    from astropy.table import MaskedColumn

    # 4.3e18 is far beyond 2**53, where float64 stops holding integers exactly.
    big = 4295806720000000001
    result = _column_to_array(
        MaskedColumn([big, big + 1], mask=[False, False], dtype=np.uint64, name="source_id")
    )

    assert int(result[0]) == big
    assert int(result[1]) == big + 1


def test_adql_applies_the_configured_limits() -> None:
    query = build_gaia_adql(L1_STELLAR_NEIGHBOURHOOD, 0, 1023)
    assert "phot_g_mean_mag < 16.0" in query
    assert "parallax_over_error > 5.0" in query
    assert "source_id BETWEEN" in query


def test_unknown_radial_velocity_is_flagged_but_a_measured_zero_is_not() -> None:
    # Source 1 measures 0.0 km/s; source 2 has none at all. Both store 0.0.
    record = normalise_gaia(sample_table(), L1_STELLAR_NEIGHBOURHOOD)

    assert not (record.type_flags[0] & FLAG_NO_RADIAL_VELOCITY)
    assert record.type_flags[1] & FLAG_NO_RADIAL_VELOCITY


def test_flagging_missing_velocity_preserves_the_object_type() -> None:
    record = normalise_gaia(sample_table(), L1_STELLAR_NEIGHBOURHOOD)

    assert np.all(object_class(record.type_flags) == CLASS_STAR)
    assert not np.any(record.type_flags & FLAG_MODELED)


def test_drops_a_bailer_jones_distance_below_the_parallax_quality_cut() -> None:
    # Source 3 has a usable r_med_geo but parallax_over_error of 1.0. The
    # estimate is derived from that same parallax, so it reports the prior.
    table = sample_table(r_med_geo=np.array([100.0, 1000.0, 500.0]))
    record = normalise_gaia(table, L1_STELLAR_NEIGHBOURHOOD)

    assert list(record.catalog_id) == [1, 2]


def test_cache_is_written_at_exactly_the_requested_path(tmp_path) -> None:
    # savez_compressed silently appends .npz to a path lacking it, which
    # previously made the staging file and the rename target disagree.
    from universe_pipeline.sources.gaia import write_cache_atomic

    target = tmp_path / "gaia-chunk-000-063.npz"
    write_cache_atomic(target, {"source_id": np.arange(4, dtype=np.uint64)})

    assert target.exists()
    assert [p.name for p in tmp_path.iterdir()] == [target.name]


def test_cached_arrays_survive_the_round_trip(tmp_path) -> None:
    from universe_pipeline.sources.gaia import write_cache_atomic

    target = tmp_path / "chunk.npz"
    big = np.array([4295806720000000001, 4295806720000000002], dtype=np.uint64)
    write_cache_atomic(target, {"source_id": big, "parallax": np.array([1.5, np.nan])})

    with np.load(target) as data:
        np.testing.assert_array_equal(data["source_id"], big)
        assert np.isnan(data["parallax"][1])


def test_no_staging_file_is_left_behind_on_success(tmp_path) -> None:
    from universe_pipeline.sources.gaia import write_cache_atomic

    target = tmp_path / "chunk.npz"
    write_cache_atomic(target, {"x": np.zeros(2)})

    assert list(tmp_path.glob("*.part")) == []
    assert list(tmp_path.glob("*.part.npz")) == []
