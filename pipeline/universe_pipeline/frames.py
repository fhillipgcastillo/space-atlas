"""ICRS to Galactic Cartesian transforms.

astropy owns the actual rotation. This module fixes the units, the axis order
and the Gaia column conventions, and pipeline/tests/test_frames.py pins that
usage down.

Galactic Cartesian axes, Sun at the origin:
    +X toward the galactic centre (l = 0, b = 0)
    +Y toward l = 90 degrees
    +Z toward the north galactic pole
"""

from __future__ import annotations

import astropy.units as u
import numpy as np
from astropy.coordinates import Galactic, SkyCoord

# 1 pc = 648000/pi AU, 1 AU = 149597870700 m, 1 ly = 9460730472580800 m (all exact).
LY_PER_PC = (648000.0 / np.pi) * 149597870700.0 / 9460730472580800.0
PC_PER_LY = 1.0 / LY_PER_PC


def parallax_to_distance_pc(parallax_mas: np.ndarray) -> np.ndarray:
    """Naive parallax inversion. Biased at low signal-to-noise; callers must
    apply a parallax_over_error cut before relying on this."""
    return 1000.0 / np.asarray(parallax_mas, dtype=np.float64)


def _icrs(ra_deg: np.ndarray, dec_deg: np.ndarray, **kwargs: object) -> SkyCoord:
    return SkyCoord(
        ra=np.asarray(ra_deg, dtype=np.float64) * u.deg,
        dec=np.asarray(dec_deg, dtype=np.float64) * u.deg,
        frame="icrs",
        **kwargs,
    )


def icrs_to_galactic_lb(
    ra_deg: np.ndarray, dec_deg: np.ndarray
) -> tuple[np.ndarray, np.ndarray]:
    """Galactic longitude and latitude in degrees."""
    galactic = _icrs(ra_deg, dec_deg).transform_to(Galactic())
    return (
        np.asarray(galactic.l.to_value(u.deg), dtype=np.float64),
        np.asarray(galactic.b.to_value(u.deg), dtype=np.float64),
    )


def icrs_to_galactic_cartesian(
    ra_deg: np.ndarray, dec_deg: np.ndarray, distance_pc: np.ndarray
) -> np.ndarray:
    """Positions as an (N, 3) array of parsecs in the Galactic frame."""
    ra_deg = np.asarray(ra_deg, dtype=np.float64)
    if ra_deg.size == 0:
        return np.zeros((0, 3), dtype=np.float64)

    coord = _icrs(ra_deg, dec_deg, distance=np.asarray(distance_pc, dtype=np.float64) * u.pc)
    cartesian = coord.transform_to(Galactic()).cartesian
    return np.stack(
        [
            cartesian.x.to_value(u.pc),
            cartesian.y.to_value(u.pc),
            cartesian.z.to_value(u.pc),
        ],
        axis=-1,
    ).astype(np.float64)


def icrs_to_galactic_velocity(
    ra_deg: np.ndarray,
    dec_deg: np.ndarray,
    distance_pc: np.ndarray,
    pmra_mas_yr: np.ndarray,
    pmdec_mas_yr: np.ndarray,
    rv_km_s: np.ndarray,
) -> np.ndarray:
    """Space velocity as an (N, 3) array of km/s in the Galactic frame.

    Gaia's `pmra` already carries the cos(dec) factor, so it maps to astropy's
    `pm_ra_cosdec`. Using `pm_ra` instead tilts every velocity toward the poles.

    The result stays heliocentric: no correction for the Sun's own motion is
    applied, which is what a Sun-origin layer wants.
    """
    ra_deg = np.asarray(ra_deg, dtype=np.float64)
    if ra_deg.size == 0:
        return np.zeros((0, 3), dtype=np.float64)

    coord = _icrs(
        ra_deg,
        dec_deg,
        distance=np.asarray(distance_pc, dtype=np.float64) * u.pc,
        pm_ra_cosdec=np.asarray(pmra_mas_yr, dtype=np.float64) * u.mas / u.yr,
        pm_dec=np.asarray(pmdec_mas_yr, dtype=np.float64) * u.mas / u.yr,
        radial_velocity=np.asarray(rv_km_s, dtype=np.float64) * u.km / u.s,
    )
    d_xyz = coord.transform_to(Galactic()).velocity.d_xyz.to_value(u.km / u.s)
    return np.ascontiguousarray(d_xyz.T, dtype=np.float64)
