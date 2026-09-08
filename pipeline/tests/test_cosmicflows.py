import numpy as np
import pytest

from universe_pipeline.config import L3_LOCAL_UNIVERSE
from universe_pipeline.records import (
    CLASS_GALAXY,
    FLAG_NO_RADIAL_VELOCITY,
    FLAG_NOMINAL_MAGNITUDE,
    object_class,
)
from universe_pipeline.sources.cosmicflows import (
    distance_modulus_to_mpc,
    normalise_cosmicflows,
)


def sample(**overrides: np.ndarray) -> dict[str, np.ndarray]:
    table = {
        # DM 31.0 -> 15.85 Mpc -> 51.7 Mly, comfortably inside the layer.
        "ra": np.array([266.40510, 10.0, 200.0, 45.0]),
        "dec": np.array([-28.93617, 20.0, -40.0, 10.0]),
        "dm": np.array([31.0, 33.0, 39.5, 18.0]),
        "pgc": np.array([1, 2, 3, 4], dtype=np.uint64),
        "vpec": np.array([250.0, np.nan, 100.0, 0.0]),
    }
    table.update(overrides)
    return table


def test_distance_modulus_matches_the_standard_relation() -> None:
    # DM = 5*log10(d_pc) - 5, so d_Mpc = 10**((DM - 25) / 5).
    np.testing.assert_allclose(
        distance_modulus_to_mpc(np.array([25.0, 30.0, 35.0])),
        np.array([1.0, 10.0, 100.0]),
        rtol=1e-9,
    )


def test_drops_galaxies_outside_the_layer_range() -> None:
    record, _ = normalise_cosmicflows(sample(), L3_LOCAL_UNIVERSE)
    # DM 39.5 is about 2600 Mly (beyond 300) and DM 18.0 about 0.13 Mly
    # (inside 0.3), so only the first two survive.
    assert len(record) == 2


def test_places_the_galactic_centre_direction_on_positive_x() -> None:
    record, _ = normalise_cosmicflows(sample(), L3_LOCAL_UNIVERSE)
    unit = record.position_ly[0] / np.linalg.norm(record.position_ly[0])
    np.testing.assert_allclose(unit, np.array([1.0, 0.0, 0.0]), atol=1e-5)


def test_distance_is_expressed_in_the_layer_unit() -> None:
    record, _ = normalise_cosmicflows(sample(), L3_LOCAL_UNIVERSE)
    # 15.85 Mpc * 3.2616 Mly/Mpc = 51.7 Mly
    assert float(np.linalg.norm(record.position_ly[0])) == pytest.approx(51.7, rel=0.01)


def test_peculiar_velocity_is_radial_because_that_is_all_the_catalogue_knows() -> None:
    record, _ = normalise_cosmicflows(sample(), L3_LOCAL_UNIVERSE)
    direction = record.position_ly[0] / np.linalg.norm(record.position_ly[0])
    np.testing.assert_allclose(record.velocity_km_s[0], direction * 250.0, rtol=1e-4)


def test_missing_peculiar_velocity_is_flagged_not_assumed_zero() -> None:
    record, _ = normalise_cosmicflows(sample(), L3_LOCAL_UNIVERSE)
    assert not record.type_flags[0] & FLAG_NO_RADIAL_VELOCITY
    assert record.type_flags[1] & FLAG_NO_RADIAL_VELOCITY
    assert np.all(np.isfinite(record.velocity_km_s))


def test_everything_is_a_galaxy_with_a_nominal_magnitude() -> None:
    record, _ = normalise_cosmicflows(sample(), L3_LOCAL_UNIVERSE)
    assert np.all(object_class(record.type_flags) == CLASS_GALAXY)
    assert np.all(record.type_flags & FLAG_NOMINAL_MAGNITUDE)


def test_names_carry_the_pgc_identifier_in_local_id_order() -> None:
    record, names = normalise_cosmicflows(sample(), L3_LOCAL_UNIVERSE)
    assert len(names) == len(record)
    assert names[0] == "PGC 1"
