"""Solar system bodies from astropy's built-in ephemeris."""

from __future__ import annotations

import astropy.units as u
import numpy as np
from astropy.coordinates import (
    Galactic,
    SkyCoord,
    get_body_barycentric_posvel,
    solar_system_ephemeris,
)
from astropy.time import Time

from universe_pipeline.config import LayerConfig
from universe_pipeline.records import (
    CLASS_PLANET,
    CLASS_STAR,
    FLAG_NOMINAL_MAGNITUDE,
    ObjectRecord,
    pack_type,
)

BODIES = (
    "sun",
    "mercury",
    "venus",
    "earth",
    "mars",
    "jupiter",
    "saturn",
    "uranus",
    "neptune",
)

# Planets shine by reflection and have no absolute magnitude in the stellar
# sense. This is a rendering size, flagged so the hover card says so.
NOMINAL_ABS_MAG = 1.0
NOMINAL_COLOUR = 30000


def _to_galactic(xyz: np.ndarray) -> np.ndarray:
    """Rotate ICRS Cartesian components into the Galactic frame.

    Applied to velocities as well as positions: the transform is a pure
    rotation, so the unit attached here is stripped again unchanged.
    """
    coord = SkyCoord(
        x=xyz[:, 0] * u.AU,
        y=xyz[:, 1] * u.AU,
        z=xyz[:, 2] * u.AU,
        representation_type="cartesian",
        frame="icrs",
    )
    cartesian = coord.transform_to(Galactic()).cartesian
    return np.stack(
        [
            cartesian.x.to_value(u.AU),
            cartesian.y.to_value(u.AU),
            cartesian.z.to_value(u.AU),
        ],
        axis=-1,
    ).astype(np.float64)


def build_solar_system(
    layer: LayerConfig, epoch: str = "J2000"
) -> tuple[ObjectRecord, list[str]]:
    when = Time(epoch)
    positions, velocities = [], []

    with solar_system_ephemeris.set("builtin"):
        sun_pos, sun_vel = get_body_barycentric_posvel("sun", when)
        for body in BODIES:
            pos, vel = get_body_barycentric_posvel(body, when)
            positions.append((pos - sun_pos).xyz.to_value(u.AU))
            velocities.append((vel - sun_vel).xyz.to_value(u.km / u.s))

    position_au = _to_galactic(np.asarray(positions, dtype=np.float64))
    velocity = _to_galactic(np.asarray(velocities, dtype=np.float64))

    n = len(BODIES)
    flags = np.array(
        [
            pack_type(CLASS_STAR if body == "sun" else CLASS_PLANET, FLAG_NOMINAL_MAGNITUDE)
            for body in BODIES
        ],
        dtype=np.uint8,
    )

    # position_ly holds AU here: the field always carries the layer's own unit.
    record = ObjectRecord(
        position_ly=position_au,
        velocity_km_s=velocity.astype(np.float32),
        abs_mag=np.full(n, NOMINAL_ABS_MAG, dtype=np.float32),
        colour_index=np.full(n, NOMINAL_COLOUR, dtype=np.uint16),
        type_flags=flags,
        catalog_id=np.arange(n, dtype=np.uint64),
    )
    return record, [body.capitalize() for body in BODIES]
