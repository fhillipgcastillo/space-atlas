import numpy as np
import pytest
from astropy.cosmology import Planck18

from universe_pipeline.config import L4_COSMIC_WEB
from universe_pipeline.records import (
    CLASS_GALAXY,
    FLAG_MODELED,
    FLAG_NO_RADIAL_VELOCITY,
    FLAG_NOMINAL_MAGNITUDE,
    object_class,
)
from universe_pipeline.sources.cosmic_web import (
    MLY_PER_MPC,
    NOMINAL_QUASAR_ABS_MAG,
    normalise_cosmic_web,
    redshift_to_comoving_mly,
)


def sample(**overrides: np.ndarray) -> dict[str, np.ndarray]:
    table = {
        # z 0.1 -> 1411 Mly and z 0.5 -> 6348 Mly are inside the layer;
        # z 3.0 is 21213 Mly, z 0.005 is 71 Mly, and the last has no redshift.
        "ra": np.array([266.40510, 10.0, 200.0, 45.0, 300.0]),
        "dec": np.array([-28.93617, 20.0, -40.0, 10.0, 60.0]),
        "z": np.array([0.1, 0.5, 3.0, 0.005, np.nan]),
        "name": np.array(["3C 273", "QSO B", "QSO C", "QSO D", "QSO E"]),
        "recno": np.array([1, 2, 3, 4, 5], dtype=np.uint64),
    }
    table.update(overrides)
    return table


def test_comoving_distance_matches_planck18_in_mly() -> None:
    z = np.array([0.1, 1.0, 2.0])
    np.testing.assert_allclose(
        redshift_to_comoving_mly(z),
        Planck18.comoving_distance(z).to_value("Mpc") * MLY_PER_MPC,
        rtol=1e-12,
    )


def test_comoving_distance_has_the_magnitude_of_a_cosmological_distance() -> None:
    # Pinned from Planck18 so a stray factor of 1e6 between Mpc, Mly and pc
    # cannot pass: z = 1 is 11.1 Gly, not 11.1 Mly and not 11.1 kly.
    np.testing.assert_allclose(
        redshift_to_comoving_mly(np.array([0.1, 1.0, 3.0])),
        np.array([1410.84, 11075.08, 21213.22]),
        rtol=1e-4,
    )


def test_missing_or_non_positive_redshift_yields_no_distance() -> None:
    assert np.all(np.isnan(redshift_to_comoving_mly(np.array([np.nan, 0.0, -0.1]))))


def test_drops_quasars_outside_the_layer_range() -> None:
    record, _ = normalise_cosmic_web(sample(), L4_COSMIC_WEB)
    assert len(record) == 2


def test_positions_land_at_the_comoving_distance_in_layer_units() -> None:
    record, _ = normalise_cosmic_web(sample(), L4_COSMIC_WEB)
    radius = np.linalg.norm(record.position_ly, axis=1)
    np.testing.assert_allclose(
        radius, redshift_to_comoving_mly(np.array([0.1, 0.5])), rtol=1e-6
    )
    assert np.all(radius >= L4_COSMIC_WEB.min_radius)
    assert np.all(radius <= L4_COSMIC_WEB.max_radius)


def test_places_the_galactic_centre_direction_on_positive_x() -> None:
    record, _ = normalise_cosmic_web(sample(), L4_COSMIC_WEB)
    unit = record.position_ly[0] / np.linalg.norm(record.position_ly[0])
    np.testing.assert_allclose(unit, np.array([1.0, 0.0, 0.0]), atol=1e-5)


def test_every_quasar_is_a_galaxy() -> None:
    record, _ = normalise_cosmic_web(sample(), L4_COSMIC_WEB)
    assert np.all(object_class(record.type_flags) == CLASS_GALAXY)


def test_magnitude_is_nominal_and_flagged_as_such() -> None:
    record, _ = normalise_cosmic_web(sample(), L4_COSMIC_WEB)
    assert np.all(record.abs_mag == pytest.approx(NOMINAL_QUASAR_ABS_MAG))
    assert np.all(record.type_flags & FLAG_NOMINAL_MAGNITUDE)


def test_zero_velocity_is_flagged_because_redshift_gives_no_transverse_motion() -> None:
    record, _ = normalise_cosmic_web(sample(), L4_COSMIC_WEB)
    assert np.all(record.velocity_km_s == 0.0)
    assert np.all(record.type_flags & FLAG_NO_RADIAL_VELOCITY)


def test_quasars_are_measured_objects_and_are_never_flagged_modeled() -> None:
    record, _ = normalise_cosmic_web(sample(), L4_COSMIC_WEB)
    assert not np.any(record.type_flags & FLAG_MODELED)


def test_names_and_identifiers_come_back_in_local_id_order() -> None:
    record, names = normalise_cosmic_web(sample(), L4_COSMIC_WEB)
    assert names == ["3C 273", "QSO B"]
    assert len(names) == len(record)
    np.testing.assert_array_equal(record.catalog_id, np.array([1, 2], dtype=np.uint64))


def test_an_empty_table_normalises_to_an_empty_record() -> None:
    empty = {key: value[:0] for key, value in sample().items()}
    record, names = normalise_cosmic_web(empty, L4_COSMIC_WEB)
    assert len(record) == 0
    assert names == []
    assert record.position_ly.shape == (0, 3)
