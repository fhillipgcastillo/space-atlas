"""The normalized schema every catalog source produces."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

CLASS_MASK = 0x0F
FLAG_MASK = 0xF0

CLASS_UNKNOWN = 0
CLASS_STAR = 1
CLASS_GALAXY = 2
CLASS_BLACK_HOLE = 3
CLASS_NEBULA = 4
CLASS_CLUSTER = 5
CLASS_PLANET = 6
CLASS_MOON = 7

FLAG_MODELED = 0x10
# Velocity's radial component is unknown, stored as zero. Not a measured zero.
FLAG_NO_RADIAL_VELOCITY = 0x20
FLAG_NOMINAL_MAGNITUDE = 0x40


def pack_type(cls: int, flags: int = 0) -> int:
    if not 0 <= cls <= CLASS_MASK:
        raise ValueError(f"object class {cls} does not fit in the class nibble")
    if flags & CLASS_MASK:
        raise ValueError(f"flag bits {flags:#04x} overlap the class nibble")
    return cls | flags


def object_class(packed: np.ndarray) -> np.ndarray:
    return np.asarray(packed) & CLASS_MASK


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
