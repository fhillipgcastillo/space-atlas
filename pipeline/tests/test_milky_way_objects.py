import numpy as np
import pytest

from universe_pipeline.config import L2_MILKY_WAY
from universe_pipeline.records import (
    CLASS_BLACK_HOLE,
    CLASS_CLUSTER,
    FLAG_MODELED,
    FLAG_NOMINAL_MAGNITUDE,
    object_class,
)
from universe_pipeline.sources.milky_way_objects import (
    SGR_A_STAR_DISTANCE_LY,
    normalise_milky_way_objects,
)


def sample(**overrides):
    table = {
        "ra": np.array([266.41684, 10.0, 200.0, 45.0]),
        "dec": np.array([-29.00781, 20.0, -40.0, 10.0]),
        "distance_ly": np.array([26670.0, 20000.0, 5000.0, 900000.0]),
        "abs_mag": np.array([np.nan, -7.5, np.nan, -6.0]),
        "kind": np.array([2, 0, 1, 0], dtype=np.uint8),
        "name": np.array(["Sagittarius A*", "NGC 104", "Pleiades-like", "Far cluster"]),
    }
    table.update(overrides)
    return table


def test_sagittarius_a_star_sits_toward_the_galactic_centre() -> None:
    record, names = normalise_milky_way_objects(sample(), L2_MILKY_WAY)
    i = names.index("Sagittarius A*")
    unit = record.position_ly[i] / np.linalg.norm(record.position_ly[i])
    np.testing.assert_allclose(unit, np.array([1.0, 0.0, 0.0]), atol=2e-3)
    assert float(np.linalg.norm(record.position_ly[i])) == pytest.approx(
        SGR_A_STAR_DISTANCE_LY, rel=1e-6
    )


def test_object_classes_follow_the_kind_column() -> None:
    record, names = normalise_milky_way_objects(sample(), L2_MILKY_WAY)
    classes = object_class(record.type_flags)
    assert classes[names.index("Sagittarius A*")] == CLASS_BLACK_HOLE
    assert classes[names.index("NGC 104")] == CLASS_CLUSTER


def test_a_measured_magnitude_is_not_flagged_nominal() -> None:
    record, names = normalise_milky_way_objects(sample(), L2_MILKY_WAY)
    assert not record.type_flags[names.index("NGC 104")] & FLAG_NOMINAL_MAGNITUDE


def test_a_missing_magnitude_is_flagged_nominal() -> None:
    record, names = normalise_milky_way_objects(sample(), L2_MILKY_WAY)
    assert record.type_flags[names.index("Pleiades-like")] & FLAG_NOMINAL_MAGNITUDE


def test_no_real_object_is_ever_flagged_modeled() -> None:
    record, _ = normalise_milky_way_objects(sample(), L2_MILKY_WAY)
    assert not np.any(record.type_flags & FLAG_MODELED)


def test_objects_beyond_the_layer_are_dropped() -> None:
    record, names = normalise_milky_way_objects(sample(), L2_MILKY_WAY)
    assert "Far cluster" not in names


def test_names_are_returned_in_local_id_order() -> None:
    record, names = normalise_milky_way_objects(sample(), L2_MILKY_WAY)
    assert len(names) == len(record)
    assert names[0] == "Sagittarius A*"


def test_clusters_nearer_than_the_layer_minimum_are_kept() -> None:
    # The stellar neighbourhood carries Gaia stars, not clusters, so a cluster
    # at 500 ly belongs to no other layer. Cutting it here would lose it.
    table = sample(distance_ly=np.array([26670.0, 20000.0, 500.0, 900000.0]))
    record, names = normalise_milky_way_objects(table, L2_MILKY_WAY)

    assert "Pleiades-like" in names
    near = float(np.linalg.norm(record.position_ly[names.index("Pleiades-like")]))
    assert near == pytest.approx(500.0, rel=1e-6)


def test_objects_beyond_the_outer_bound_are_still_dropped() -> None:
    table = sample(distance_ly=np.array([26670.0, 20000.0, 500.0, 900000.0]))
    _, names = normalise_milky_way_objects(table, L2_MILKY_WAY)

    assert "Far cluster" not in names


def test_a_non_positive_distance_is_dropped_rather_than_placed_at_the_origin() -> None:
    table = sample(distance_ly=np.array([26670.0, 0.0, -5.0, 20000.0]))
    record, _ = normalise_milky_way_objects(table, L2_MILKY_WAY)

    assert len(record) == 2


def test_sexagesimal_coordinates_parse_to_degrees() -> None:
    # Harris gives RA in sexagesimal HOURS, not degrees. Reading '00 24 05.2'
    # as a float raises; reading it as degrees would be wrong by a factor 15.
    from universe_pipeline.sources.milky_way_objects import sexagesimal_to_degrees

    ra, dec = sexagesimal_to_degrees(
        np.array(["00 24 05.2", "13 26 47.28"]), np.array(["-72 04 51", "-47 28 46.1"])
    )

    # 47 Tuc and omega Cen, from SIMBAD.
    np.testing.assert_allclose(ra, [6.0217, 201.697], atol=1e-3)
    np.testing.assert_allclose(dec, [-72.0808, -47.4795], atol=1e-3)


def test_a_float_read_of_the_harris_coordinates_would_fail() -> None:
    # Pins why the helper exists: the naive conversion raises rather than
    # quietly producing wrong numbers, but only on a cold cache.
    with pytest.raises(ValueError):
        np.asarray(np.array(["00 24 05.2"]), dtype=np.float64)


def test_every_globular_gets_a_non_empty_display_name() -> None:
    from universe_pipeline.sources.milky_way_objects import globular_display_names

    # Name is blank for 101 of the 147 Harris rows; ID is always populated.
    names = globular_display_names(
        np.array(["NGC 104", "NGC 288", "NGC 5139"]), np.array(["47 Tuc", "", "omega Cen"])
    )

    assert names == ["NGC 104 (47 Tuc)", "NGC 288", "NGC 5139 (omega Cen)"]
    assert all(name.strip() for name in names)
