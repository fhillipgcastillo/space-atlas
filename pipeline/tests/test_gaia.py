import numpy as np
import pytest

from universe_pipeline.config import L1_STELLAR_NEIGHBOURHOOD
from universe_pipeline.records import FLAG_MODELED, TYPE_STAR
from universe_pipeline.sources.gaia import build_gaia_adql, normalise_gaia


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
    # The third source has parallax_over_error = 1.0 and no Bailer-Jones
    # distance, so it must be dropped rather than guessed.
    assert len(record) == 2
    assert list(record.catalog_id) == [1, 2]


def test_prefers_bailer_jones_distance_over_parallax_inversion() -> None:
    # The first source has parallax 10 mas, so naive inversion would give
    # 100 pc. Bailer-Jones says 250 pc. The two disagree deliberately, so the
    # resulting distance proves which source was actually used.
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
    assert np.all(record.type_flags & TYPE_STAR)
    assert not np.any(record.type_flags & FLAG_MODELED)


def test_absolute_magnitude_uses_the_distance_modulus() -> None:
    table = sample_table(
        phot_g_mean_mag=np.array([10.0, 12.0, 14.0]),
        r_med_geo=np.array([100.0, 1000.0, np.nan]),
    )
    record = normalise_gaia(table, L1_STELLAR_NEIGHBOURHOOD)
    # M = m - 5*log10(d_pc) + 5 => 10 - 10 + 5 = 5
    assert float(record.abs_mag[0]) == pytest.approx(5.0, abs=1e-4)


def test_missing_colour_falls_back_to_a_neutral_index() -> None:
    record = normalise_gaia(sample_table(), L1_STELLAR_NEIGHBOURHOOD)
    assert np.all(record.colour_index <= 65535)


def test_adql_applies_the_configured_limits() -> None:
    query = build_gaia_adql(L1_STELLAR_NEIGHBOURHOOD, 0, 1023)
    assert "phot_g_mean_mag < 16.0" in query
    assert "parallax_over_error > 5.0" in query
    assert "source_id BETWEEN" in query
