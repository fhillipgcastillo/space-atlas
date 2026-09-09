import numpy as np
import pytest

from universe_pipeline.config import L2_MILKY_WAY
from universe_pipeline.records import (
    CLASS_STAR,
    FLAG_MODELED,
    FLAG_NO_RADIAL_VELOCITY,
    FLAG_NOMINAL_MAGNITUDE,
    object_class,
)
from universe_pipeline.sources.milky_way_model import (
    SUN_GALACTOCENTRIC_RADIUS_LY,
    build_modeled_population,
)


def test_every_generated_point_is_flagged_modeled() -> None:
    record = build_modeled_population(L2_MILKY_WAY, 20_000)
    assert np.all(record.type_flags & FLAG_MODELED)
    assert np.all(record.type_flags & FLAG_NOMINAL_MAGNITUDE)
    assert np.all(object_class(record.type_flags) == CLASS_STAR)


def test_the_model_claims_no_kinematics() -> None:
    record = build_modeled_population(L2_MILKY_WAY, 5_000)
    assert np.all(record.velocity_km_s == 0.0)
    assert np.all(record.type_flags & FLAG_NO_RADIAL_VELOCITY)


def test_the_population_is_centred_on_the_galactic_centre_not_the_sun() -> None:
    # Positions are heliocentric, so the density peak sits about 26,670 ly away
    # toward +X, not at the origin.
    record = build_modeled_population(L2_MILKY_WAY, 60_000)
    centroid_x = float(np.median(record.position_ly[:, 0]))
    assert centroid_x == pytest.approx(SUN_GALACTOCENTRIC_RADIUS_LY, rel=0.35)


def test_the_disk_is_flattened() -> None:
    record = build_modeled_population(L2_MILKY_WAY, 60_000)
    spread_in_plane = float(np.std(record.position_ly[:, 1]))
    spread_vertical = float(np.std(record.position_ly[:, 2]))
    assert spread_vertical < spread_in_plane / 3


def test_generation_is_deterministic_for_a_seed() -> None:
    a = build_modeled_population(L2_MILKY_WAY, 3_000, seed=7)
    b = build_modeled_population(L2_MILKY_WAY, 3_000, seed=7)
    np.testing.assert_array_equal(a.position_ly, b.position_ly)


def test_different_seeds_give_different_populations() -> None:
    a = build_modeled_population(L2_MILKY_WAY, 3_000, seed=1)
    b = build_modeled_population(L2_MILKY_WAY, 3_000, seed=2)
    assert not np.array_equal(a.position_ly, b.position_ly)


def test_nothing_falls_outside_the_layer() -> None:
    record = build_modeled_population(L2_MILKY_WAY, 40_000)
    r = np.linalg.norm(record.position_ly, axis=1)
    assert np.all(r <= L2_MILKY_WAY.max_radius)


def test_requested_count_is_honoured() -> None:
    assert len(build_modeled_population(L2_MILKY_WAY, 12_345)) == 12_345


def test_an_empty_request_produces_an_empty_record() -> None:
    assert len(build_modeled_population(L2_MILKY_WAY, 0)) == 0
