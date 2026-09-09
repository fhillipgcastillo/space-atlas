"""A generated stellar population for the Milky Way layer.

The only invented data in the project: galactic dust hides most of the Galaxy
from Gaia, so nothing measured gives it a shape. Every point is flagged
modeled, carries a nominal magnitude and claims no motion.
"""

from __future__ import annotations

from collections.abc import Callable

import numpy as np

from universe_pipeline.config import LayerConfig
from universe_pipeline.records import (
    CLASS_STAR,
    FLAG_MODELED,
    FLAG_NO_RADIAL_VELOCITY,
    FLAG_NOMINAL_MAGNITUDE,
    ObjectRecord,
    pack_type,
)

# 8.178 kpc (GRAVITY Collaboration 2019).
SUN_GALACTOCENTRIC_RADIUS_LY = 26670.0

# The Sun sits at galactocentric -X, so subtracting its position leaves the
# Galactic Centre at +X, where the galactic frame of every other layer puts it.
SUN_GALACTOCENTRIC_POSITION_LY = np.array([-SUN_GALACTOCENTRIC_RADIUS_LY, 0.0, 0.0])

# Component structure assumed from the standard three-component Galaxy model
# (Bland-Hawthorn & Gerhard 2016). These are assumptions, not measurements.
THIN_DISK_FRACTION = 0.72
THIN_DISK_SCALE_LENGTH_LY = 8480.0  # 2.6 kpc
THIN_DISK_SCALE_HEIGHT_LY = 980.0  # 300 pc

THICK_DISK_FRACTION = 0.18
THICK_DISK_SCALE_LENGTH_LY = 11700.0  # 3.6 kpc
THICK_DISK_SCALE_HEIGHT_LY = 2940.0  # 900 pc

BULGE_FRACTION = 0.08
BULGE_SCALE_LY = 2280.0  # 700 pc
BULGE_TRUNCATION_SIGMA = 3.0

HALO_FRACTION = 0.02
HALO_POWER_LAW_INDEX = 3.5
HALO_INNER_RADIUS_LY = 3000.0

# Each point stands for tens of thousands of stars and carries their combined
# light, not one star's.
NOMINAL_MODELED_ABS_MAG = -6.0
NOMINAL_MODELED_COLOUR = 30000

MODELED_TYPE_FLAGS = pack_type(
    CLASS_STAR, FLAG_MODELED | FLAG_NOMINAL_MAGNITUDE | FLAG_NO_RADIAL_VELOCITY
)


def _disk(
    rng: np.random.Generator, n: int, scale_length: float, scale_height: float
) -> np.ndarray:
    radius = rng.exponential(scale_length, n)
    azimuth = rng.uniform(0.0, 2.0 * np.pi, n)
    return np.column_stack(
        (
            radius * np.cos(azimuth),
            radius * np.sin(azimuth),
            rng.laplace(0.0, scale_height, n),
        )
    )


def _bulge(rng: np.random.Generator, n: int) -> np.ndarray:
    limit = BULGE_TRUNCATION_SIGMA * BULGE_SCALE_LY
    xyz = rng.normal(0.0, BULGE_SCALE_LY, (n, 3))
    beyond = np.linalg.norm(xyz, axis=1) > limit
    while np.any(beyond):
        xyz[beyond] = rng.normal(0.0, BULGE_SCALE_LY, (int(beyond.sum()), 3))
        beyond[beyond] = np.linalg.norm(xyz[beyond], axis=1) > limit
    return xyz


def _halo(rng: np.random.Generator, n: int, outer_radius_ly: float) -> np.ndarray:
    exponent = 1.0 - HALO_POWER_LAW_INDEX
    inner = HALO_INNER_RADIUS_LY**exponent
    outer = outer_radius_ly**exponent
    radius = (inner + rng.uniform(0.0, 1.0, n) * (outer - inner)) ** (1.0 / exponent)
    direction = rng.normal(0.0, 1.0, (n, 3))
    direction /= np.maximum(np.linalg.norm(direction, axis=1, keepdims=True), 1e-12)
    return direction * radius[:, None]


def _component_samplers(
    layer: LayerConfig,
) -> list[Callable[[np.random.Generator, int], np.ndarray]]:
    return [
        lambda rng, n: _disk(rng, n, THIN_DISK_SCALE_LENGTH_LY, THIN_DISK_SCALE_HEIGHT_LY),
        lambda rng, n: _disk(rng, n, THICK_DISK_SCALE_LENGTH_LY, THICK_DISK_SCALE_HEIGHT_LY),
        _bulge,
        lambda rng, n: _halo(rng, n, layer.max_radius),
    ]


def _component_counts(count: int) -> list[int]:
    fractions = (THIN_DISK_FRACTION, THICK_DISK_FRACTION, BULGE_FRACTION, HALO_FRACTION)
    counts = [int(count * fraction) for fraction in fractions]
    counts[0] += count - sum(counts)
    return counts


def build_modeled_population(layer: LayerConfig, count: int, seed: int = 0) -> ObjectRecord:
    rng = np.random.default_rng(seed)
    samplers = _component_samplers(layer)
    counts = _component_counts(count)
    component = np.repeat(np.arange(len(counts)), counts)

    position = np.zeros((count, 3), dtype=np.float64)
    pending = np.arange(count)
    while pending.size:
        for index, sampler in enumerate(samplers):
            slots = pending[component[pending] == index]
            if slots.size:
                position[slots] = sampler(rng, int(slots.size)) - SUN_GALACTOCENTRIC_POSITION_LY
        outside = np.linalg.norm(position[pending], axis=1) > layer.max_radius
        pending = pending[outside]

    return ObjectRecord(
        position_ly=position,
        velocity_km_s=np.zeros((count, 3), dtype=np.float32),
        abs_mag=np.full(count, NOMINAL_MODELED_ABS_MAG, dtype=np.float32),
        colour_index=np.full(count, NOMINAL_MODELED_COLOUR, dtype=np.uint16),
        type_flags=np.full(count, MODELED_TYPE_FLAGS, dtype=np.uint8),
        catalog_id=np.zeros(count, dtype=np.uint64),
    )
