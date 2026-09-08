"""The normalized schema every catalog source produces."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

FLAG_MODELED = 1 << 0
TYPE_STAR = 1 << 1
TYPE_GALAXY = 1 << 2
TYPE_BLACK_HOLE = 1 << 3
TYPE_NEBULA = 1 << 4
TYPE_CLUSTER = 1 << 5
# Velocity's radial component is unknown, stored as zero. Not a measured zero.
FLAG_NO_RADIAL_VELOCITY = 1 << 6


@dataclass
class ObjectRecord:
    """Parallel arrays describing objects already placed in layer coordinates."""

    position_ly: np.ndarray  # float64 (N, 3)
    velocity_km_s: np.ndarray  # float32 (N, 3)
    abs_mag: np.ndarray  # float32 (N,)
    colour_index: np.ndarray  # uint16 (N,)
    type_flags: np.ndarray  # uint8 (N,)
    catalog_id: np.ndarray  # uint64 (N,)

    def __len__(self) -> int:
        return int(self.position_ly.shape[0])

    def take(self, mask: np.ndarray) -> ObjectRecord:
        return ObjectRecord(
            position_ly=self.position_ly[mask],
            velocity_km_s=self.velocity_km_s[mask],
            abs_mag=self.abs_mag[mask],
            colour_index=self.colour_index[mask],
            type_flags=self.type_flags[mask],
            catalog_id=self.catalog_id[mask],
        )
