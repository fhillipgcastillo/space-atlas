import numpy as np
import pytest

from universe_pipeline.octree import build_octree, iter_nodes


def random_positions(n: int, seed: int = 0) -> np.ndarray:
    rng = np.random.default_rng(seed)
    # Deliberately clustered: uniform data hides bugs that clumped data exposes.
    centres = rng.uniform(-500.0, 500.0, size=(12, 3))
    picks = rng.integers(0, len(centres), size=n)
    return centres[picks] + rng.normal(0.0, 30.0, size=(n, 3))


def test_every_point_appears_exactly_once() -> None:
    positions = random_positions(20_000)
    root = build_octree(positions, max_points_per_node=512)

    seen = np.concatenate([node.indices for node in iter_nodes(root)])

    assert seen.size == len(positions)
    np.testing.assert_array_equal(np.sort(seen), np.arange(len(positions)))


def test_no_node_exceeds_its_point_budget() -> None:
    root = build_octree(random_positions(20_000), max_points_per_node=512)
    assert all(node.indices.size <= 512 for node in iter_nodes(root))


def test_every_node_bounding_box_contains_its_own_points() -> None:
    positions = random_positions(20_000)
    root = build_octree(positions, max_points_per_node=512)

    for node in iter_nodes(root):
        if node.indices.size == 0:
            continue
        owned = positions[node.indices]
        assert np.all(owned >= node.bbox_min - 1e-9)
        assert np.all(owned <= node.bbox_max + 1e-9)


def test_child_boxes_nest_inside_the_parent_box() -> None:
    root = build_octree(random_positions(20_000), max_points_per_node=512)

    for node in iter_nodes(root):
        for child in node.children:
            assert np.all(child.bbox_min >= node.bbox_min - 1e-9)
            assert np.all(child.bbox_max <= node.bbox_max + 1e-9)


def test_total_point_count_is_preserved_at_every_node() -> None:
    root = build_octree(random_positions(20_000), max_points_per_node=512)

    for node in iter_nodes(root):
        expected = node.indices.size + sum(child.total_points for child in node.children)
        assert node.total_points == expected

    assert root.total_points == 20_000


def test_geometric_error_shrinks_with_depth() -> None:
    root = build_octree(random_positions(20_000), max_points_per_node=512)

    for node in iter_nodes(root):
        for child in node.children:
            assert child.geometric_error < node.geometric_error


def test_node_paths_are_unique_and_encode_the_tree() -> None:
    root = build_octree(random_positions(20_000), max_points_per_node=512)

    paths = [node.path for node in iter_nodes(root)]
    assert len(paths) == len(set(paths))
    assert root.path == "r"
    for node in iter_nodes(root):
        for child in node.children:
            assert child.path.startswith(node.path)
            assert len(child.path) == len(node.path) + 1


def test_small_input_produces_a_single_leaf() -> None:
    positions = random_positions(100)
    root = build_octree(positions, max_points_per_node=512)

    assert root.children == []
    assert root.indices.size == 100


def test_empty_input_produces_an_empty_root() -> None:
    root = build_octree(np.zeros((0, 3)), max_points_per_node=512)
    assert root.total_points == 0
    assert root.indices.size == 0


def test_build_is_deterministic_for_a_fixed_seed() -> None:
    positions = random_positions(5_000)
    a = build_octree(positions, max_points_per_node=256, seed=42)
    b = build_octree(positions, max_points_per_node=256, seed=42)

    for node_a, node_b in zip(iter_nodes(a), iter_nodes(b), strict=True):
        assert node_a.path == node_b.path
        np.testing.assert_array_equal(node_a.indices, node_b.indices)


def test_identical_points_do_not_recurse_forever() -> None:
    positions = np.zeros((5_000, 3))
    root = build_octree(positions, max_points_per_node=64)

    assert root.total_points == 5_000
    depth = max(len(node.path) for node in iter_nodes(root))
    assert depth < 40


def test_rejects_a_non_positive_budget() -> None:
    with pytest.raises(ValueError, match="max_points_per_node"):
        build_octree(random_positions(10), max_points_per_node=0)
