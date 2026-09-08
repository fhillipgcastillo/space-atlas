import numpy as np
import pytest

from universe_pipeline.config import L0_SOLAR_SYSTEM
from universe_pipeline.records import (
    CLASS_PLANET,
    CLASS_STAR,
    FLAG_NOMINAL_MAGNITUDE,
    object_class,
)
from universe_pipeline.sources.solar_system import BODIES, build_solar_system


def test_returns_one_record_per_body_with_matching_names() -> None:
    record, names = build_solar_system(L0_SOLAR_SYSTEM)
    assert len(record) == len(BODIES)
    assert len(names) == len(BODIES)
    assert names[0] == "Sun"
    assert "Jupiter" in names


def test_the_sun_sits_at_the_origin() -> None:
    record, names = build_solar_system(L0_SOLAR_SYSTEM)
    sun = names.index("Sun")
    assert np.linalg.norm(record.position_ly[sun]) < 1e-6


def test_planet_distances_match_their_known_orbits() -> None:
    # Semi-major axes in AU. Eccentricity means the instantaneous radius
    # differs from a, so the tolerance is generous but still discriminating:
    # a unit error or a wrong frame would be orders of magnitude out.
    expected = {
        "Mercury": 0.39, "Venus": 0.72, "Earth": 1.00, "Mars": 1.52,
        "Jupiter": 5.20, "Saturn": 9.54, "Uranus": 19.19, "Neptune": 30.07,
    }
    record, names = build_solar_system(L0_SOLAR_SYSTEM)
    for name, a in expected.items():
        # Mercury's eccentricity is 0.206 and at J2000 it sits at aphelion, so
        # its true radius is 20% above a -- outside the tolerance the rest need.
        rel = 0.25 if name == "Mercury" else 0.15
        r = float(np.linalg.norm(record.position_ly[names.index(name)]))
        assert r == pytest.approx(a, rel=rel), f"{name} at {r:.3f} AU, expected about {a}"


def test_the_sun_is_a_star_and_the_rest_are_planets() -> None:
    record, names = build_solar_system(L0_SOLAR_SYSTEM)
    classes = object_class(record.type_flags)
    assert classes[names.index("Sun")] == CLASS_STAR
    assert classes[names.index("Earth")] == CLASS_PLANET


def test_magnitudes_are_marked_nominal_because_none_are_measured() -> None:
    record, _ = build_solar_system(L0_SOLAR_SYSTEM)
    assert np.all(record.type_flags & FLAG_NOMINAL_MAGNITUDE)


def test_velocities_are_real_orbital_motion_not_zero() -> None:
    record, names = build_solar_system(L0_SOLAR_SYSTEM)
    earth = names.index("Earth")
    speed = float(np.linalg.norm(record.velocity_km_s[earth]))
    # Earth orbits at about 29.8 km/s.
    assert speed == pytest.approx(29.8, rel=0.1)


def test_every_body_falls_inside_the_layer_radius() -> None:
    record, _ = build_solar_system(L0_SOLAR_SYSTEM)
    r = np.linalg.norm(record.position_ly, axis=1)
    assert np.all(r <= L0_SOLAR_SYSTEM.max_radius)


def test_positions_are_galactic_not_equatorial() -> None:
    # The ecliptic is inclined about 60 degrees to the galactic plane, so a
    # planet's galactic latitude is nowhere near zero. If the transform were
    # skipped, planets would sit close to the equatorial plane instead.
    record, names = build_solar_system(L0_SOLAR_SYSTEM)
    pos = record.position_ly[names.index("Neptune")]
    b = np.degrees(np.arcsin(pos[2] / np.linalg.norm(pos)))
    assert abs(b) > 5.0
