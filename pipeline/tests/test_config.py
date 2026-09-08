import pytest

from universe_pipeline.config import (
    AU_IN_METRES,
    L0_SOLAR_SYSTEM,
    L1_STELLAR_NEIGHBOURHOOD,
    L3_LOCAL_UNIVERSE,
    LAYERS,
)


def test_every_layer_is_registered_under_its_own_key() -> None:
    for layer in (L0_SOLAR_SYSTEM, L1_STELLAR_NEIGHBOURHOOD, L3_LOCAL_UNIVERSE):
        assert LAYERS[layer.key] is layer


def test_layers_are_ordered_by_scale_without_overlap_in_metres() -> None:
    ordered = sorted(LAYERS.values(), key=lambda x: x.min_radius * x.unit_in_metres)
    for inner, outer in zip(ordered, ordered[1:], strict=False):
        assert inner.min_radius * inner.unit_in_metres < outer.min_radius * outer.unit_in_metres


def test_radii_are_expressed_in_the_layer_unit() -> None:
    # A radius silently in the wrong unit is the likeliest bug here and is
    # invisible in the rendered result, so pin the magnitudes.
    assert L0_SOLAR_SYSTEM.unit == "AU"
    assert L0_SOLAR_SYSTEM.max_radius == pytest.approx(100.0)
    assert L1_STELLAR_NEIGHBOURHOOD.unit == "ly"
    assert L1_STELLAR_NEIGHBOURHOOD.max_radius == pytest.approx(5000.0)
    assert L3_LOCAL_UNIVERSE.unit == "Mly"
    assert L3_LOCAL_UNIVERSE.max_radius == pytest.approx(300.0)


def test_unit_scales_are_consistent_with_each_other() -> None:
    assert AU_IN_METRES == pytest.approx(1.495978707e11)
    ly = L1_STELLAR_NEIGHBOURHOOD.unit_in_metres
    assert L3_LOCAL_UNIVERSE.unit_in_metres == pytest.approx(ly * 1e6)


def test_every_layer_declares_a_tile_budget_the_pick_encoding_can_address() -> None:
    for layer in LAYERS.values():
        assert 0 < layer.max_points_per_tile <= (1 << 20)
