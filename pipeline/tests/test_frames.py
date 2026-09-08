"""Golden tests for coordinate transforms.

Reference values are exactly-defined quantities, not measured star distances:

- The IAU galactic pole and centre directions are definitional (Hipparcos/IAU
  1958 convention, as implemented by astropy's Galactic frame).
- Parallax inversion is arithmetic: d[pc] == 1000 / parallax[mas].
- Sagittarius A* sits within a twentieth of a degree of the galactic origin;
  ICRS 266.41684, -29.00781 -> l = 359.944, b = -0.046.
"""

import numpy as np
import pytest

from universe_pipeline.frames import (
    LY_PER_PC,
    icrs_to_galactic_cartesian,
    icrs_to_galactic_lb,
    icrs_to_galactic_velocity,
    parallax_to_distance_pc,
)

ARCSEC_DEG = 1.0 / 3600.0

NORTH_GALACTIC_POLE_ICRS = (192.85948, 27.12825)
GALACTIC_CENTRE_ICRS = (266.40510, -28.93617)
SGR_A_STAR_ICRS = (266.41684, -29.00781)


def test_parallax_inversion_is_exact() -> None:
    parallax = np.array([768.0665, 100.0, 1.0])
    np.testing.assert_allclose(
        parallax_to_distance_pc(parallax),
        np.array([1000.0 / 768.0665, 10.0, 1000.0]),
        rtol=1e-12,
    )


def test_light_year_conversion_matches_the_iau_definition() -> None:
    # 1 pc = 648000/pi AU; 1 ly = 9460730472580800 m exactly (IAU).
    assert LY_PER_PC == pytest.approx(3.261563777167433, rel=1e-12)


def test_north_galactic_pole_maps_to_latitude_90() -> None:
    ra, dec = NORTH_GALACTIC_POLE_ICRS
    _, b = icrs_to_galactic_lb(np.array([ra]), np.array([dec]))
    assert abs(b[0] - 90.0) < ARCSEC_DEG


def test_galactic_centre_maps_to_the_origin() -> None:
    ra, dec = GALACTIC_CENTRE_ICRS
    lon, lat = icrs_to_galactic_lb(np.array([ra]), np.array([dec]))
    # Longitude wraps; fold to [-180, 180) before comparing to zero.
    folded = (lon[0] + 180.0) % 360.0 - 180.0
    assert abs(folded) < ARCSEC_DEG
    assert abs(lat[0]) < ARCSEC_DEG


def test_sagittarius_a_star_lands_where_the_literature_puts_it() -> None:
    ra, dec = SGR_A_STAR_ICRS
    lon, lat = icrs_to_galactic_lb(np.array([ra]), np.array([dec]))
    assert lon[0] == pytest.approx(359.9442, abs=0.001)
    assert lat[0] == pytest.approx(-0.0462, abs=0.001)


def test_axis_convention_places_the_galactic_centre_on_positive_x() -> None:
    ra, dec = GALACTIC_CENTRE_ICRS
    xyz = icrs_to_galactic_cartesian(np.array([ra]), np.array([dec]), np.array([100.0]))
    np.testing.assert_allclose(xyz[0], np.array([100.0, 0.0, 0.0]), atol=1e-3)


def test_axis_convention_places_the_galactic_pole_on_positive_z() -> None:
    ra, dec = NORTH_GALACTIC_POLE_ICRS
    xyz = icrs_to_galactic_cartesian(np.array([ra]), np.array([dec]), np.array([100.0]))
    np.testing.assert_allclose(xyz[0], np.array([0.0, 0.0, 100.0]), atol=1e-3)


def test_cartesian_magnitude_equals_the_input_distance() -> None:
    rng = np.random.default_rng(7)
    n = 500
    ra = rng.uniform(0.0, 360.0, n)
    dec = np.degrees(np.arcsin(rng.uniform(-1.0, 1.0, n)))
    distance = rng.uniform(1.0, 1500.0, n)

    xyz = icrs_to_galactic_cartesian(ra, dec, distance)

    np.testing.assert_allclose(np.linalg.norm(xyz, axis=1), distance, rtol=1e-9)


def test_pure_radial_velocity_is_parallel_to_the_position_vector() -> None:
    ra = np.array([120.0])
    dec = np.array([-15.0])
    distance = np.array([50.0])

    xyz = icrs_to_galactic_cartesian(ra, dec, distance)
    velocity = icrs_to_galactic_velocity(
        ra, dec, distance,
        pmra_mas_yr=np.array([0.0]),
        pmdec_mas_yr=np.array([0.0]),
        rv_km_s=np.array([10.0]),
    )

    direction = xyz[0] / np.linalg.norm(xyz[0])
    np.testing.assert_allclose(velocity[0], direction * 10.0, atol=1e-6)


def test_pure_proper_motion_is_perpendicular_to_the_position_vector() -> None:
    ra = np.array([200.0])
    dec = np.array([35.0])
    distance = np.array([10.0])

    xyz = icrs_to_galactic_cartesian(ra, dec, distance)
    velocity = icrs_to_galactic_velocity(
        ra, dec, distance,
        pmra_mas_yr=np.array([50.0]),
        pmdec_mas_yr=np.array([-30.0]),
        rv_km_s=np.array([0.0]),
    )

    direction = xyz[0] / np.linalg.norm(xyz[0])
    assert abs(float(np.dot(velocity[0], direction))) < 1e-6


def test_tangential_speed_matches_the_standard_4_74047_relation() -> None:
    # v_t [km/s] = 4.74047 * mu["/yr] * d[pc], with mu given here in mas/yr.
    distance_pc = 100.0
    pmra = 20.0
    velocity = icrs_to_galactic_velocity(
        np.array([10.0]), np.array([20.0]), np.array([distance_pc]),
        pmra_mas_yr=np.array([pmra]),
        pmdec_mas_yr=np.array([0.0]),
        rv_km_s=np.array([0.0]),
    )
    expected = 4.74047 * (pmra / 1000.0) * distance_pc
    assert float(np.linalg.norm(velocity[0])) == pytest.approx(expected, rel=1e-4)


def test_transforms_handle_empty_input() -> None:
    empty = np.array([], dtype=float)
    assert icrs_to_galactic_cartesian(empty, empty, empty).shape == (0, 3)
