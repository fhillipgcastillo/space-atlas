"""Cosmicflows-4 galaxies from VizieR catalogue J/ApJ/944/94."""

from __future__ import annotations

from collections.abc import Mapping
from pathlib import Path

import numpy as np

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

CF4_CATALOG = "J/ApJ/944/94"
MLY_PER_MPC = 3.261563777167433
PC_PER_MPC = 1.0e6

# CF4 carries no photometry, so brightness is a rendering choice and is
# flagged as such rather than presented as a measurement.
NOMINAL_GALAXY_ABS_MAG = -20.5
NOMINAL_GALAXY_COLOUR = 42000


def distance_modulus_to_mpc(dm: np.ndarray) -> np.ndarray:
    return 10.0 ** ((np.asarray(dm, dtype=np.float64) - 25.0) / 5.0)


def fetch_cosmicflows(cache_dir: Path) -> dict[str, np.ndarray]:
    """Individual galaxies joined to their group's peculiar velocity."""
    cached = cache_dir / "cosmicflows4.npz"
    if cached.exists():
        with np.load(cached) as data:
            return {key: data[key] for key in data.files}

    from astroquery.vizier import Vizier

    vizier = Vizier(columns=["**"], row_limit=-1)
    tables = vizier.get_catalogs(CF4_CATALOG)
    galaxies = tables[f"{CF4_CATALOG}/table2"]
    groups = tables[f"{CF4_CATALOG}/groups"]

    # Peculiar velocity is measured per group, so a galaxy inherits its
    # group's value. Galaxies whose group has none keep NaN.
    group_id = np.asarray(groups["1PGC"], dtype=np.int64)
    group_vpec = np.asarray(groups["Vpec"], dtype=np.float64)
    order = np.argsort(group_id)
    keys, values = group_id[order], group_vpec[order]

    galaxy_group = np.asarray(galaxies["1PGC"], dtype=np.int64)
    slot = np.searchsorted(keys, galaxy_group)
    slot = np.clip(slot, 0, len(keys) - 1)
    matched = keys[slot] == galaxy_group
    vpec = np.where(matched, values[slot], np.nan)

    arrays = {
        "ra": np.asarray(galaxies["RAJ2000"], dtype=np.float64),
        "dec": np.asarray(galaxies["DEJ2000"], dtype=np.float64),
        "dm": np.asarray(galaxies["DM"], dtype=np.float64),
        "pgc": np.asarray(galaxies["PGC"], dtype=np.uint64),
        "vpec": vpec,
    }
    cache_dir.mkdir(parents=True, exist_ok=True)
    write_cache_atomic(cached, arrays)
    return arrays


def normalise_cosmicflows(
    table: Mapping[str, np.ndarray], layer: LayerConfig
) -> tuple[ObjectRecord, list[str]]:
    dm = np.asarray(table["dm"], dtype=np.float64)
    distance_mly = distance_modulus_to_mpc(dm) * MLY_PER_MPC

    keep = np.isfinite(distance_mly)
    keep &= distance_mly >= layer.min_radius
    keep &= distance_mly <= layer.max_radius

    ra = np.asarray(table["ra"], dtype=np.float64)[keep]
    dec = np.asarray(table["dec"], dtype=np.float64)[keep]
    distance_mly = distance_mly[keep]

    # icrs_to_galactic_cartesian works in parsecs; feed it the distance in Mpc
    # scaled to pc, then convert the result back to the layer unit.
    distance_pc = distance_mly / MLY_PER_MPC * PC_PER_MPC
    position = icrs_to_galactic_cartesian(ra, dec, distance_pc) / PC_PER_MPC * MLY_PER_MPC

    raw_vpec = np.asarray(table["vpec"], dtype=np.float64)[keep]
    missing = ~np.isfinite(raw_vpec)
    vpec = np.nan_to_num(raw_vpec, nan=0.0)

    radial = position / np.maximum(
        np.linalg.norm(position, axis=1, keepdims=True), 1e-12
    )
    velocity = radial * vpec[:, None]

    n = int(keep.sum())
    flags = np.full(n, pack_type(CLASS_GALAXY, FLAG_NOMINAL_MAGNITUDE), dtype=np.uint8)
    flags[missing] |= FLAG_NO_RADIAL_VELOCITY

    pgc = np.asarray(table["pgc"], dtype=np.uint64)[keep]
    record = ObjectRecord(
        position_ly=position,
        velocity_km_s=velocity.astype(np.float32),
        abs_mag=np.full(n, NOMINAL_GALAXY_ABS_MAG, dtype=np.float32),
        colour_index=np.full(n, NOMINAL_GALAXY_COLOUR, dtype=np.uint16),
        type_flags=flags,
        catalog_id=pgc,
    )
    return record, [f"PGC {int(p)}" for p in pgc]
