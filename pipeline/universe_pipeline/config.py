"""All pipeline tunables."""

from __future__ import annotations

from dataclasses import dataclass

LY_IN_METRES = 9460730472580800.0
MLY_IN_METRES = LY_IN_METRES * 1e6
AU_IN_METRES = 149597870700.0


@dataclass(frozen=True)
class LayerConfig:
    key: str
    unit: str
    unit_in_metres: float
    min_radius: float
    max_radius: float
    origin: str
    max_points_per_tile: int


@dataclass(frozen=True)
class GaiaTuning:
    g_mag_limit: float
    min_parallax_over_error: float


# g_mag_limit drives density: G < 16 yields about 33 million sources inside 5000 ly.
GAIA_TUNING = GaiaTuning(g_mag_limit=16.0, min_parallax_over_error=5.0)

L0_SOLAR_SYSTEM = LayerConfig(
    key="solar-system",
    unit="AU",
    unit_in_metres=AU_IN_METRES,
    min_radius=0.0,
    max_radius=100.0,
    origin="Sun",
    max_points_per_tile=65536,
)

L1_STELLAR_NEIGHBOURHOOD = LayerConfig(
    key="stellar-neighbourhood",
    unit="ly",
    unit_in_metres=LY_IN_METRES,
    min_radius=0.01,
    max_radius=5000.0,
    origin="Sol",
    max_points_per_tile=65536,
)

L2_MILKY_WAY = LayerConfig(
    key="milky-way",
    unit="ly",
    unit_in_metres=LY_IN_METRES,
    min_radius=3000.0,
    max_radius=400000.0,
    origin="Sol",
    max_points_per_tile=65536,
)

L3_LOCAL_UNIVERSE = LayerConfig(
    key="local-universe",
    unit="Mly",
    unit_in_metres=MLY_IN_METRES,
    min_radius=0.3,
    max_radius=300.0,
    origin="Milky Way",
    max_points_per_tile=65536,
)

LAYERS: dict[str, LayerConfig] = {
    layer.key: layer
    for layer in (L0_SOLAR_SYSTEM, L1_STELLAR_NEIGHBOURHOOD, L2_MILKY_WAY, L3_LOCAL_UNIVERSE)
}
