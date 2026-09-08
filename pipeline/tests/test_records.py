import numpy as np
import pytest

from universe_pipeline.records import (
    CLASS_GALAXY,
    CLASS_PLANET,
    CLASS_STAR,
    FLAG_MODELED,
    FLAG_NO_RADIAL_VELOCITY,
    FLAG_NOMINAL_MAGNITUDE,
    object_class,
    pack_type,
)


def test_class_and_flags_round_trip() -> None:
    packed = pack_type(CLASS_GALAXY, FLAG_NOMINAL_MAGNITUDE | FLAG_NO_RADIAL_VELOCITY)
    assert object_class(np.array([packed]))[0] == CLASS_GALAXY
    assert packed & FLAG_NOMINAL_MAGNITUDE
    assert packed & FLAG_NO_RADIAL_VELOCITY
    assert not packed & FLAG_MODELED


def test_every_class_fits_in_the_nibble() -> None:
    for cls in (CLASS_STAR, CLASS_GALAXY, CLASS_PLANET):
        assert 0 <= cls <= 15
        assert object_class(np.array([pack_type(cls, 0xF0)]))[0] == cls


def test_flags_do_not_collide_with_the_class_nibble() -> None:
    for flag in (FLAG_MODELED, FLAG_NO_RADIAL_VELOCITY, FLAG_NOMINAL_MAGNITUDE):
        assert flag & 0x0F == 0


def test_packed_value_fits_in_a_uint8() -> None:
    packed = pack_type(15, FLAG_MODELED | FLAG_NO_RADIAL_VELOCITY | FLAG_NOMINAL_MAGNITUDE)
    assert 0 <= packed <= 255
    assert np.uint8(packed) == packed


def test_rejects_a_class_that_does_not_fit() -> None:
    with pytest.raises(ValueError, match="class"):
        pack_type(16, 0)


def test_rejects_flags_that_overlap_the_class_nibble() -> None:
    with pytest.raises(ValueError, match="flag"):
        pack_type(CLASS_STAR, 0x01)
