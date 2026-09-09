"""Measured Milky Way objects: globular clusters, open clusters, Sagittarius A*."""

from __future__ import annotations

from collections.abc import Mapping
from pathlib import Path

import numpy as np

from universe_pipeline.config import LayerConfig
from universe_pipeline.frames import LY_PER_PC, PC_PER_LY, icrs_to_galactic_cartesian
from universe_pipeline.records import (
    CLASS_BLACK_HOLE,
    CLASS_CLUSTER,
    FLAG_NO_RADIAL_VELOCITY,
    FLAG_NOMINAL_MAGNITUDE,
    ObjectRecord,
    pack_type,
)
from universe_pipeline.sources.gaia import write_cache_atomic

GLOBULAR_CLUSTER_TABLE = "VII/202/catalog"
OPEN_CLUSTER_TABLE = "J/A+A/640/A1/table1"

KIND_GLOBULAR_CLUSTER = 0
KIND_OPEN_CLUSTER = 1
KIND_BLACK_HOLE = 2

SGR_A_STAR_ICRS = (266.41684, -29.00781)
SGR_A_STAR_DISTANCE_LY = 26670.0
SGR_A_STAR_NAME = "Sagittarius A*"

LY_PER_KPC = 1000.0 * LY_PER_PC

# Neither cluster catalogue carries a colour, and a black hole has none; one
# nominal value stands in for all three.
NOMINAL_COLOUR = 30000
# Cantat-Gaudin lists no photometry, and Sagittarius A* shines by accretion
# rather than starlight, so both take a rendering brightness, not a measurement.
NOMINAL_ABS_MAG = -5.0

_CLUSTER_FLAGS = pack_type(CLASS_CLUSTER, FLAG_NO_RADIAL_VELOCITY)
_BLACK_HOLE_FLAGS = pack_type(CLASS_BLACK_HOLE, FLAG_NO_RADIAL_VELOCITY)


def fetch_milky_way_objects(cache_dir: Path) -> dict[str, np.ndarray]:
    """The two cluster catalogues joined, with Sagittarius A* appended."""
    cached = cache_dir / "milky-way-objects.npz"
    if cached.exists():
        with np.load(cached) as data:
            return {key: data[key] for key in data.files}

    from astroquery.vizier import Vizier

    vizier = Vizier(columns=["**"], row_limit=-1)
    globulars = vizier.get_catalogs(GLOBULAR_CLUSTER_TABLE)[GLOBULAR_CLUSTER_TABLE]
    opens = vizier.get_catalogs(OPEN_CLUSTER_TABLE)[OPEN_CLUSTER_TABLE]

    globular_distance_ly = np.asarray(globulars["Rsun"], dtype=np.float64) * LY_PER_KPC
    open_distance_ly = np.asarray(opens["DistPc"], dtype=np.float64) * LY_PER_PC

    arrays = {
        "ra": np.concatenate(
            [
                np.asarray(globulars["RAJ2000"], dtype=np.float64),
                np.asarray(opens["RA_ICRS"], dtype=np.float64),
                np.array([SGR_A_STAR_ICRS[0]], dtype=np.float64),
            ]
        ),
        "dec": np.concatenate(
            [
                np.asarray(globulars["DEJ2000"], dtype=np.float64),
                np.asarray(opens["DE_ICRS"], dtype=np.float64),
                np.array([SGR_A_STAR_ICRS[1]], dtype=np.float64),
            ]
        ),
        "distance_ly": np.concatenate(
            [
                globular_distance_ly,
                open_distance_ly,
                np.array([SGR_A_STAR_DISTANCE_LY], dtype=np.float64),
            ]
        ),
        "abs_mag": np.concatenate(
            [
                np.asarray(globulars["MVt"], dtype=np.float64),
                np.full(len(opens), np.nan),
                np.array([np.nan]),
            ]
        ),
        "kind": np.concatenate(
            [
                np.full(len(globulars), KIND_GLOBULAR_CLUSTER, dtype=np.uint8),
                np.full(len(opens), KIND_OPEN_CLUSTER, dtype=np.uint8),
                np.array([KIND_BLACK_HOLE], dtype=np.uint8),
            ]
        ),
        "name": np.concatenate(
            [
                np.asarray(globulars["Name"], dtype=np.str_),
                np.asarray(opens["Cluster"], dtype=np.str_),
                np.array([SGR_A_STAR_NAME], dtype=np.str_),
            ]
        ),
    }
    cache_dir.mkdir(parents=True, exist_ok=True)
    write_cache_atomic(cached, arrays)
    return arrays


def normalise_milky_way_objects(
    table: Mapping[str, np.ndarray], layer: LayerConfig
) -> tuple[ObjectRecord, list[str]]:
    distance_ly = np.asarray(table["distance_ly"], dtype=np.float64)
    # Only the outer bound applies. min_radius exists so a layer does not repeat
    # what an inner layer already carries, and the stellar neighbourhood carries
    # Gaia stars, never clusters - so cutting there would leave every cluster
    # nearer than 3000 ly in no layer at all.
    keep = np.isfinite(distance_ly)
    keep &= distance_ly > 0.0
    keep &= distance_ly <= layer.max_radius

    ra = np.asarray(table["ra"], dtype=np.float64)[keep]
    dec = np.asarray(table["dec"], dtype=np.float64)[keep]
    distance_ly = distance_ly[keep]

    # icrs_to_galactic_cartesian works in parsecs both in and out.
    position = icrs_to_galactic_cartesian(ra, dec, distance_ly * PC_PER_LY) * LY_PER_PC

    measured_mag = np.asarray(table["abs_mag"], dtype=np.float64)[keep]
    nominal = ~np.isfinite(measured_mag)
    abs_mag = np.where(nominal, NOMINAL_ABS_MAG, measured_mag)

    kind = np.asarray(table["kind"], dtype=np.uint8)[keep]
    flags = np.where(kind == KIND_BLACK_HOLE, _BLACK_HOLE_FLAGS, _CLUSTER_FLAGS).astype(np.uint8)
    flags[nominal] |= FLAG_NOMINAL_MAGNITUDE

    n = int(keep.sum())
    record = ObjectRecord(
        position_ly=position,
        velocity_km_s=np.zeros((n, 3), dtype=np.float32),
        abs_mag=abs_mag.astype(np.float32),
        colour_index=np.full(n, NOMINAL_COLOUR, dtype=np.uint16),
        type_flags=flags,
        # Neither catalogue supplies a numeric identifier.
        catalog_id=np.zeros(n, dtype=np.uint64),
    )
    return record, [str(name) for name in np.asarray(table["name"])[keep]]
