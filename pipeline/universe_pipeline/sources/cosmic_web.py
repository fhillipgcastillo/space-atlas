"""Quasars from VizieR catalogue VII/294, placed by comoving distance."""

from __future__ import annotations

from collections.abc import Mapping
from pathlib import Path

import numpy as np
from astropy.cosmology import Planck18

from universe_pipeline.config import LayerConfig
from universe_pipeline.frames import icrs_to_galactic_cartesian
from universe_pipeline.records import (
    CLASS_GALAXY,
    FLAG_NO_RADIAL_VELOCITY,
    FLAG_NOMINAL_MAGNITUDE,
    ObjectRecord,
    pack_type,
)
from universe_pipeline.sources.gaia import write_cache_atomic

QUASAR_CATALOG = "VII/294/catalog"
MLY_PER_MPC = 3.261563777167433
PC_PER_MPC = 1.0e6

# Quasars really are this luminous, but the value is assigned rather than
# derived per object, so it ships flagged as nominal.
NOMINAL_QUASAR_ABS_MAG = -26.0
# Blue end of the ramp: quasar continua are strongly blue-excess.
NOMINAL_QUASAR_COLOUR = 8000


def redshift_to_comoving_mly(z: np.ndarray) -> np.ndarray:
    """Comoving distance in Mly under Planck18; non-positive redshift gives NaN."""
    z = np.asarray(z, dtype=np.float64)
    if z.size == 0:
        return np.zeros_like(z)
    usable = np.isfinite(z) & (z > 0.0)
    mpc = Planck18.comoving_distance(np.where(usable, z, 1.0)).to_value("Mpc")
    return np.where(usable, np.asarray(mpc, dtype=np.float64) * MLY_PER_MPC, np.nan)


def fetch_cosmic_web(cache_dir: Path) -> dict[str, np.ndarray]:
    cached = cache_dir / "cosmic_web.npz"
    if cached.exists():
        with np.load(cached) as data:
            return {key: data[key] for key in data.files}

    from astroquery.vizier import Vizier

    vizier = Vizier(columns=["recno", "RAJ2000", "DEJ2000", "Name", "z"], row_limit=-1)
    table = vizier.get_catalogs(QUASAR_CATALOG)[0]

    redshift = np.asarray(table["z"], dtype=np.float64)
    missing = getattr(table["z"], "mask", None)
    if missing is not None:
        redshift = np.where(np.asarray(missing), np.nan, redshift)

    arrays = {
        "ra": np.asarray(table["RAJ2000"], dtype=np.float64),
        "dec": np.asarray(table["DEJ2000"], dtype=np.float64),
        "z": redshift,
        "name": np.asarray(table["Name"], dtype=np.str_),
        "recno": np.asarray(table["recno"], dtype=np.uint64),
    }
    cache_dir.mkdir(parents=True, exist_ok=True)
    write_cache_atomic(cached, arrays)
    return arrays


def normalise_cosmic_web(
    table: Mapping[str, np.ndarray], layer: LayerConfig
) -> tuple[ObjectRecord, list[str]]:
    distance_mly = redshift_to_comoving_mly(table["z"])

    keep = np.isfinite(distance_mly)
    keep &= distance_mly >= layer.min_radius
    keep &= distance_mly <= layer.max_radius

    ra = np.asarray(table["ra"], dtype=np.float64)[keep]
    dec = np.asarray(table["dec"], dtype=np.float64)[keep]
    distance_mly = distance_mly[keep]

    # icrs_to_galactic_cartesian works in parsecs, so scale Mly through Mpc on
    # the way in and back to Mly on the way out.
    distance_pc = distance_mly / MLY_PER_MPC * PC_PER_MPC
    position = icrs_to_galactic_cartesian(ra, dec, distance_pc) / PC_PER_MPC * MLY_PER_MPC

    n = int(keep.sum())
    # Redshift fixes a distance and nothing about transverse motion, so the
    # stored velocity is a placeholder, not a measurement of zero.
    flags = pack_type(CLASS_GALAXY, FLAG_NOMINAL_MAGNITUDE | FLAG_NO_RADIAL_VELOCITY)

    recno = np.asarray(table["recno"], dtype=np.uint64)[keep]
    record = ObjectRecord(
        position_ly=position,
        velocity_km_s=np.zeros((n, 3), dtype=np.float32),
        abs_mag=np.full(n, NOMINAL_QUASAR_ABS_MAG, dtype=np.float32),
        colour_index=np.full(n, NOMINAL_QUASAR_COLOUR, dtype=np.uint16),
        type_flags=np.full(n, flags, dtype=np.uint8),
        catalog_id=recno,
    )
    names = [str(name).strip() for name in np.asarray(table["name"])[keep]]
    return record, names
