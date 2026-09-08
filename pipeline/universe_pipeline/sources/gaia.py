"""Gaia DR3 to ObjectRecord."""

from __future__ import annotations

from collections.abc import Mapping
from pathlib import Path

import numpy as np

from universe_pipeline.config import LayerConfig
from universe_pipeline.frames import (
    LY_PER_PC,
    icrs_to_galactic_cartesian,
    icrs_to_galactic_velocity,
    parallax_to_distance_pc,
)
from universe_pipeline.records import (
    CLASS_STAR,
    FLAG_NO_RADIAL_VELOCITY,
    ObjectRecord,
    pack_type,
)

# BP-RP spans roughly -0.5 (hot blue) to 5.0 (cool red) for real stars.
BP_RP_MIN = -0.5
BP_RP_MAX = 5.0
BP_RP_NEUTRAL = 0.8


def build_gaia_adql(layer: LayerConfig, healpix_lo: int, healpix_hi: int) -> str:
    """One chunk of the layer, bounded by HEALPix level-8 source_id range."""
    # Gaia source_id encodes HEALPix level 12 in bits 59 and up.
    shift = 2 ** (59 - 2 * 8)
    return f"""
SELECT g.source_id, g.ra, g.dec, g.parallax, g.parallax_over_error,
       g.pmra, g.pmdec, g.radial_velocity, g.phot_g_mean_mag, g.bp_rp,
       d.r_med_geo
FROM gaiadr3.gaia_source AS g
LEFT JOIN external.gaiaedr3_distance AS d ON d.source_id = g.source_id
WHERE g.source_id BETWEEN {healpix_lo * shift} AND {(healpix_hi + 1) * shift - 1}
  AND g.phot_g_mean_mag < {layer.g_mag_limit}
  AND g.parallax_over_error > {layer.min_parallax_over_error}
  AND g.parallax > {1000.0 / (layer.max_radius_ly / LY_PER_PC)}
""".strip()


def fetch_gaia_chunk(
    layer: LayerConfig, healpix_lo: int, healpix_hi: int, cache_dir: Path
) -> dict[str, np.ndarray]:
    """Run one ADQL chunk, caching the raw result on disk. Never refetches."""
    from astroquery.gaia import Gaia

    cache_dir.mkdir(parents=True, exist_ok=True)
    cached = cache_dir / f"gaia-{layer.key}-{healpix_lo:05d}-{healpix_hi:05d}.npz"
    if cached.exists():
        with np.load(cached) as data:
            return {key: data[key] for key in data.files}

    job = Gaia.launch_job_async(build_gaia_adql(layer, healpix_lo, healpix_hi))
    table = job.get_results()
    arrays = {name: _column_to_array(table[name]) for name in table.colnames}

    write_cache_atomic(cached, arrays)
    return arrays


def write_cache_atomic(path: Path, arrays: Mapping[str, np.ndarray]) -> None:
    """Write a chunk cache so an interrupted run leaves no half-written file."""
    staging = path.with_name(path.name + ".part")
    # savez_compressed appends .npz to a *path* that lacks it; a file handle
    # is written verbatim.
    with staging.open("wb") as handle:
        np.savez_compressed(handle, **arrays)
    staging.replace(path)


def _column_to_array(column: object) -> np.ndarray:
    """One astropy table column to a plain numpy array, gaps as NaN."""
    data = np.asarray(column)
    mask = getattr(column, "mask", None)
    if mask is None or not np.any(mask):
        return data
    if not np.issubdtype(data.dtype, np.floating):
        return data
    filled = data.astype(np.float64, copy=True)
    filled[mask] = np.nan
    return filled


def _column(table: Mapping[str, np.ndarray], name: str) -> np.ndarray:
    return np.asarray(table[name], dtype=np.float64)


def normalise_gaia(table: Mapping[str, np.ndarray], layer: LayerConfig) -> ObjectRecord:
    """Gaia columns to layer-space records. Drops anything it cannot place."""
    parallax = _column(table, "parallax")
    parallax_snr = _column(table, "parallax_over_error")
    bailer_jones = _column(table, "r_med_geo")

    positive_parallax = parallax > 0.0
    inverted = np.where(
        positive_parallax,
        parallax_to_distance_pc(np.where(positive_parallax, parallax, 1.0)),
        np.nan,
    )
    # The SNR cut gates both branches: a Bailer-Jones distance is derived from
    # the same parallax under a prior, so below the cut it reports the prior.
    good_parallax = parallax_snr > layer.min_parallax_over_error
    distance_pc = np.where(
        np.isfinite(bailer_jones),
        bailer_jones,
        np.where(np.isfinite(inverted), inverted, np.nan),
    )
    distance_pc = np.where(good_parallax, distance_pc, np.nan)

    keep = np.isfinite(distance_pc) & (distance_pc > 0.0)
    distance_ly = distance_pc * LY_PER_PC
    keep &= distance_ly >= layer.min_radius_ly
    keep &= distance_ly <= layer.max_radius_ly

    ra = _column(table, "ra")[keep]
    dec = _column(table, "dec")[keep]
    distance_pc = distance_pc[keep]

    position_ly = icrs_to_galactic_cartesian(ra, dec, distance_pc) * LY_PER_PC

    raw_rv = _column(table, "radial_velocity")[keep]
    missing_rv = ~np.isfinite(raw_rv)
    rv = np.nan_to_num(raw_rv, nan=0.0)
    velocity = icrs_to_galactic_velocity(
        ra,
        dec,
        distance_pc,
        pmra_mas_yr=np.nan_to_num(_column(table, "pmra")[keep], nan=0.0),
        pmdec_mas_yr=np.nan_to_num(_column(table, "pmdec")[keep], nan=0.0),
        rv_km_s=rv,
    )

    g_mag = _column(table, "phot_g_mean_mag")[keep]
    abs_mag = g_mag - 5.0 * np.log10(distance_pc) + 5.0

    bp_rp = np.nan_to_num(_column(table, "bp_rp")[keep], nan=BP_RP_NEUTRAL)
    colour = np.clip((bp_rp - BP_RP_MIN) / (BP_RP_MAX - BP_RP_MIN), 0.0, 1.0)

    n = int(keep.sum())
    type_flags = np.full(n, pack_type(CLASS_STAR), dtype=np.uint8)
    type_flags[missing_rv] |= FLAG_NO_RADIAL_VELOCITY

    return ObjectRecord(
        position_ly=position_ly,
        velocity_km_s=velocity.astype(np.float32),
        abs_mag=abs_mag.astype(np.float32),
        colour_index=np.rint(colour * 65535.0).astype(np.uint16),
        type_flags=type_flags,
        catalog_id=np.asarray(table["source_id"], dtype=np.uint64)[keep],
    )
