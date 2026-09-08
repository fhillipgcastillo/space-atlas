"""All pipeline tunables."""

from __future__ import annotations

from dataclasses import dataclass

LY_IN_METRES = 9460730472580800.0


@dataclass(frozen=True)
class LayerConfig:
    key: str
    unit: str
    unit_in_metres: float
    min_radius_ly: float
    max_radius_ly: float
    g_mag_limit: float
    min_parallax_over_error: float
    max_points_per_tile: int


# g_mag_limit drives density: G < 16 is order ten million sources inside 5000 ly.
L1_STELLAR_NEIGHBOURHOOD = LayerConfig(
    key="stellar-neighbourhood",
    unit="ly",
    unit_in_metres=LY_IN_METRES,
    min_radius_ly=0.01,
    max_radius_ly=5000.0,
    g_mag_limit=16.0,
    min_parallax_over_error=5.0,
    max_points_per_tile=65536,
)
