# Universe Map Phase 2a — Layer Stack Implementation Plan

> **For agentic workers:** Implement task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Fly continuously from the solar system out to the local universe, crossing three scale layers with automatic crossfade, without the existing 33M-star layer regressing.

**Architecture:** Layers are independent tiled datasets, each with its own unit and origin. The camera lives in the *active* layer's units; crossing a distance threshold rescales the camera and hands over. During the overlap band both layers render, the inactive one scaled into the active one's space and its opacity ramped. No coordinate space ever spans more than one layer's range, which is what keeps float precision intact across 12 orders of magnitude.

**Tech Stack:** Unchanged. Python 3.12 + astropy + astroquery + numpy; TypeScript + Vite + Three.js.

## Execution protocol

One `builder` subagent per task. Tests are the only verification oracle — no review rounds, no `superpowers:*` skills. Subagents do not run `git`; the orchestrator commits. Stay inside the files each task names.

## Global Constraints

- **Frame:** Galactic Cartesian for every layer. Layers differ in unit and origin, never in orientation — otherwise crossing a boundary would visibly rotate the sky.
- **Existing layer must not regress.** L1 stellar-neighbourhood carries 32,750,394 real Gaia stars in 1705 tiles. Every task ends with it still loading and rendering.
- **Tile format v1 byte layout is unchanged.** Task 1 changes only how `typeFlags` is *interpreted*; header, block order and sizes stay exactly as `docs/tile-format.md` describes.
- **Streaming:** max 8 in-flight requests; LRU under a 512 MB GPU budget; `maxVisibleNodes` derived from that budget, never set independently.
- **Honesty rule:** anything not measured must be distinguishable from anything measured, in the data and on the hover card.
- **Commits:** no attribution or co-author trailers.
- **Phase handoff:** stop at the end of this plan. Do not start Phase 2b.

## Layer ladder for this phase

| Layer | Key | Range | Unit | Origin | Source |
|---|---|---|---|---|---|
| L0 | `solar-system` | 0 – 0.01 ly | AU | Sun | astropy built-in ephemeris |
| L1 | `stellar-neighbourhood` | 0.01 – 5,000 ly | ly | Sol | Gaia DR3 *(exists)* |
| L3 | `local-universe` | 0.3 – 300 Mly | Mly | Milky Way | Cosmicflows-4 via VizieR |

L2 (Milky Way) and L4 (cosmic web) are later phases. L1 and L3 therefore do not touch, and the plan must not pretend otherwise — see Task 6.

## File Structure

**Pipeline**

| File | Responsibility |
|---|---|
| `pipeline/universe_pipeline/records.py` | *(modify)* class/flag split in `typeFlags` |
| `pipeline/universe_pipeline/config.py` | *(modify)* generalise `LayerConfig`; add L0 and L3 |
| `pipeline/universe_pipeline/sources/gaia.py` | *(modify)* emit the new class encoding |
| `pipeline/universe_pipeline/sources/solar_system.py` | Planets from astropy ephemeris |
| `pipeline/universe_pipeline/sources/cosmicflows.py` | CF4 from VizieR, DM to distance, group velocity join |
| `pipeline/universe_pipeline/cli.py` | *(modify)* dispatch per layer |

**App**

| File | Responsibility |
|---|---|
| `app/src/render/typeFlags.ts` | *(modify)* mirror the new encoding |
| `app/src/layers/registry.ts` | Layer definitions and their URLs |
| `app/src/layers/stack.ts` | Pure: which layers are active, blend factor, position rescale |
| `app/src/layers/layerRenderer.ts` | Owns one TileManager plus its opacity |
| `app/src/render/pointMaterial.ts` | *(modify)* add a `uLayerOpacity` uniform |
| `app/src/main.ts` | *(modify)* composition across layers |

---

### Task 1: Split `typeFlags` into a class nibble and a flag nibble

`typeFlags` is a `uint8` spending one bit per object class. With `FLAG_NO_RADIAL_VELOCITY` in place all eight bits are claimed, and this phase adds planets, galaxies and a nominal-magnitude flag. One bit per class does not fit; a 4-bit class enum gives 16 classes and leaves four flags.

The byte layout of the tile format does not change — only the meaning of the byte. Existing L1 tiles carry the old encoding, so Task 5 rebakes them.

**Files:**
- Modify: `pipeline/universe_pipeline/records.py`
- Modify: `pipeline/universe_pipeline/sources/gaia.py`
- Modify: `pipeline/universe_pipeline/tests/../tests/test_gaia.py` — path is `pipeline/tests/test_gaia.py`
- Modify: `app/src/render/typeFlags.ts`, `app/src/render/typeFlags.test.ts`
- Test: `pipeline/tests/test_records.py` (create)

**Interfaces:**
- Produces (Python, `records.py`):
  - `CLASS_MASK = 0x0F`, `FLAG_MASK = 0xF0`
  - `CLASS_UNKNOWN = 0`, `CLASS_STAR = 1`, `CLASS_GALAXY = 2`, `CLASS_BLACK_HOLE = 3`, `CLASS_NEBULA = 4`, `CLASS_CLUSTER = 5`, `CLASS_PLANET = 6`, `CLASS_MOON = 7`
  - `FLAG_MODELED = 0x10`, `FLAG_NO_RADIAL_VELOCITY = 0x20`, `FLAG_NOMINAL_MAGNITUDE = 0x40`
  - `pack_type(cls: int, flags: int = 0) -> int`
  - `object_class(packed: np.ndarray) -> np.ndarray`
- Produces (TypeScript, `typeFlags.ts`): the same constants, plus `describeType(flags: number): string` and `hasRadialVelocity(flags: number): boolean` (both already exist — update their implementations), plus `hasMeasuredMagnitude(flags: number): boolean`

- [ ] **Step 1: Write the failing Python tests**

```python
# pipeline/tests/test_records.py
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
```

- [ ] **Step 2: Run and confirm failure**

Run: `.venv/Scripts/python -m pytest pipeline/tests/test_records.py -v`
Expected: `ImportError` — `pack_type` does not exist.

- [ ] **Step 3: Rewrite the constants in `pipeline/universe_pipeline/records.py`**

Replace the existing `FLAG_MODELED`/`TYPE_*` block with:

```python
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
```

- [ ] **Step 4: Update `sources/gaia.py` to emit the new encoding**

Replace the `TYPE_STAR` import with `CLASS_STAR, FLAG_NO_RADIAL_VELOCITY, pack_type`, and replace the flag assembly at the end of `normalise_gaia` with:

```python
    type_flags = np.full(n, pack_type(CLASS_STAR), dtype=np.uint8)
    type_flags[missing_rv] |= FLAG_NO_RADIAL_VELOCITY
```

- [ ] **Step 5: Update the assertions in `pipeline/tests/test_gaia.py`**

`test_all_records_are_measured_stars` and `test_flagging_missing_velocity_preserves_the_object_type` currently test bits with `&`. Under a class nibble, `flags & CLASS_STAR` is no longer the right question — the class must be compared for equality. Change both to:

```python
    assert np.all(object_class(record.type_flags) == CLASS_STAR)
    assert not np.any(record.type_flags & FLAG_MODELED)
```

Update the imports in that file accordingly. This is a test tracking a corrected encoding, not a weakened test: equality on a nibble is strictly more precise than a bit test.

- [ ] **Step 6: Update `app/src/render/typeFlags.ts` to mirror it**

```typescript
export const CLASS_MASK = 0x0f;

export const CLASS_UNKNOWN = 0;
export const CLASS_STAR = 1;
export const CLASS_GALAXY = 2;
export const CLASS_BLACK_HOLE = 3;
export const CLASS_NEBULA = 4;
export const CLASS_CLUSTER = 5;
export const CLASS_PLANET = 6;
export const CLASS_MOON = 7;

export const FLAG_MODELED = 0x10;
export const FLAG_NO_RADIAL_VELOCITY = 0x20;
export const FLAG_NOMINAL_MAGNITUDE = 0x40;

const CLASS_NAMES: Record<number, string> = {
  [CLASS_UNKNOWN]: 'Unknown',
  [CLASS_STAR]: 'Star',
  [CLASS_GALAXY]: 'Galaxy',
  [CLASS_BLACK_HOLE]: 'Black hole',
  [CLASS_NEBULA]: 'Nebula',
  [CLASS_CLUSTER]: 'Cluster',
  [CLASS_PLANET]: 'Planet',
  [CLASS_MOON]: 'Moon',
};

export function objectClass(flags: number): number {
  return flags & CLASS_MASK;
}

export function describeType(flags: number): string {
  const name = CLASS_NAMES[objectClass(flags)] ?? 'Unknown';
  return (flags & FLAG_MODELED) !== 0 ? `${name} (modeled)` : name;
}

export function hasRadialVelocity(flags: number): boolean {
  return (flags & FLAG_NO_RADIAL_VELOCITY) === 0;
}

export function hasMeasuredMagnitude(flags: number): boolean {
  return (flags & FLAG_NOMINAL_MAGNITUDE) === 0;
}
```

- [ ] **Step 7: Update `app/src/render/typeFlags.test.ts`**

Replace the whole file:

```typescript
import { describe, expect, it } from 'vitest';
import {
  CLASS_GALAXY,
  CLASS_PLANET,
  CLASS_STAR,
  FLAG_MODELED,
  FLAG_NOMINAL_MAGNITUDE,
  FLAG_NO_RADIAL_VELOCITY,
  describeType,
  hasMeasuredMagnitude,
  hasRadialVelocity,
  objectClass,
} from './typeFlags.js';

describe('objectClass', () => {
  it('reads the class through any combination of flags', () => {
    const allFlags = FLAG_MODELED | FLAG_NO_RADIAL_VELOCITY | FLAG_NOMINAL_MAGNITUDE;
    expect(objectClass(CLASS_GALAXY | allFlags)).toBe(CLASS_GALAXY);
    expect(objectClass(CLASS_PLANET | allFlags)).toBe(CLASS_PLANET);
  });
});

describe('describeType', () => {
  it('names each class', () => {
    expect(describeType(CLASS_STAR)).toBe('Star');
    expect(describeType(CLASS_GALAXY)).toBe('Galaxy');
    expect(describeType(CLASS_PLANET)).toBe('Planet');
  });

  it('marks a modeled object so it cannot be read as measured', () => {
    expect(describeType(CLASS_STAR | FLAG_MODELED)).toBe('Star (modeled)');
  });

  it('is unaffected by the other flags', () => {
    expect(describeType(CLASS_GALAXY | FLAG_NO_RADIAL_VELOCITY | FLAG_NOMINAL_MAGNITUDE)).toBe(
      'Galaxy',
    );
  });
});

describe('flag predicates', () => {
  it('distinguishes a measured radial velocity from an unknown one', () => {
    expect(hasRadialVelocity(CLASS_STAR)).toBe(true);
    expect(hasRadialVelocity(CLASS_STAR | FLAG_NO_RADIAL_VELOCITY)).toBe(false);
  });

  it('distinguishes a measured magnitude from a nominal one', () => {
    expect(hasMeasuredMagnitude(CLASS_GALAXY)).toBe(true);
    expect(hasMeasuredMagnitude(CLASS_GALAXY | FLAG_NOMINAL_MAGNITUDE)).toBe(false);
  });
});
```

- [ ] **Step 8: Update the hover card to report a nominal magnitude honestly**

In `app/src/interaction/hover.ts`, import `hasMeasuredMagnitude` alongside the existing imports and change the magnitude line of the card to:

```typescript
        hasMeasuredMagnitude(flags)
          ? `absolute magnitude ${absMag.toFixed(2)}`
          : `absolute magnitude ${absMag.toFixed(2)} (nominal)`,
```

- [ ] **Step 9: Verify**

Run each and expect green:
```
.venv/Scripts/python -m pytest pipeline/tests -q
.venv/Scripts/python -m ruff check pipeline
npx vitest run
npm run typecheck
npm run lint
```

- [ ] **Step 10: Commit**

```bash
git add pipeline/universe_pipeline/records.py pipeline/universe_pipeline/sources/gaia.py \
        pipeline/tests/test_records.py pipeline/tests/test_gaia.py \
        app/src/render/typeFlags.ts app/src/render/typeFlags.test.ts app/src/interaction/hover.ts
git commit -m "refactor: split typeFlags into a class nibble and a flag nibble"
```

---

### Task 2: Generalise `LayerConfig` and declare the three layers

`LayerConfig` carries `g_mag_limit` and `min_parallax_over_error`, which are Gaia's business and meaningless for planets or galaxies. Source-specific tuning moves into the source modules; `LayerConfig` keeps only what every layer has.

**Files:**
- Modify: `pipeline/universe_pipeline/config.py`
- Modify: `pipeline/universe_pipeline/sources/gaia.py`
- Test: `pipeline/tests/test_config.py` (create)

**Interfaces:**
- Produces:
  - `LayerConfig` with fields `key: str`, `unit: str`, `unit_in_metres: float`, `min_radius: float`, `max_radius: float`, `origin: str`, `max_points_per_tile: int` — radii are in the layer's own unit, not light-years
  - `GaiaTuning` dataclass with `g_mag_limit: float`, `min_parallax_over_error: float`; module constant `GAIA_TUNING`
  - `L0_SOLAR_SYSTEM`, `L1_STELLAR_NEIGHBOURHOOD`, `L3_LOCAL_UNIVERSE`
  - `LAYERS: dict[str, LayerConfig]`
  - `AU_IN_METRES = 149597870700.0`, `MLY_IN_METRES = LY_IN_METRES * 1e6`

- [ ] **Step 1: Write the failing test**

```python
# pipeline/tests/test_config.py
import pytest

from universe_pipeline.config import (
    AU_IN_METRES,
    LAYERS,
    L0_SOLAR_SYSTEM,
    L1_STELLAR_NEIGHBOURHOOD,
    L3_LOCAL_UNIVERSE,
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
```

- [ ] **Step 2: Run and confirm failure**

Run: `.venv/Scripts/python -m pytest pipeline/tests/test_config.py -v`
Expected: `ImportError` on `AU_IN_METRES`.

- [ ] **Step 3: Rewrite `pipeline/universe_pipeline/config.py`**

```python
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
    for layer in (L0_SOLAR_SYSTEM, L1_STELLAR_NEIGHBOURHOOD, L3_LOCAL_UNIVERSE)
}
```

- [ ] **Step 4: Update `sources/gaia.py` for the moved fields**

`build_gaia_adql` and `normalise_gaia` currently read `layer.g_mag_limit`, `layer.min_parallax_over_error`, `layer.min_radius_ly` and `layer.max_radius_ly`. Give both functions a `tuning: GaiaTuning = GAIA_TUNING` keyword parameter, read the limits from it, and read the radii as `layer.min_radius` / `layer.max_radius` (still light-years, because L1's unit is `ly`).

- [ ] **Step 5: Update `pipeline/tests/test_gaia.py` call sites**

Any test passing `L1_STELLAR_NEIGHBOURHOOD` continues to work unchanged; `test_adql_applies_the_configured_limits` still asserts the same substrings because `GAIA_TUNING` carries the same values.

- [ ] **Step 6: Verify and commit**

```
.venv/Scripts/python -m pytest pipeline/tests -q
.venv/Scripts/python -m ruff check pipeline
```

```bash
git add pipeline/universe_pipeline/config.py pipeline/universe_pipeline/sources/gaia.py \
        pipeline/tests/test_config.py pipeline/tests/test_gaia.py
git commit -m "refactor(pipeline): generalise LayerConfig and declare three layers"
```

---

### Task 3: Solar system source

Nine bodies from astropy's built-in ephemeris. No download, no hand-entered orbital elements — astropy already integrates the ephemeris, and hardcoding Keplerian elements is exactly the kind of plausible-but-wrong data this project avoids.

**Files:**
- Create: `pipeline/universe_pipeline/sources/solar_system.py`
- Test: `pipeline/tests/test_solar_system.py`

**Interfaces:**
- Consumes: `frames.py` (nothing new), `records.py` from Task 1, `config.py` from Task 2.
- Produces:
  - `BODIES: tuple[str, ...]` — `("sun", "mercury", "venus", "earth", "mars", "jupiter", "saturn", "uranus", "neptune")`
  - `NOMINAL_ABS_MAG: float = 1.0`
  - `build_solar_system(layer: LayerConfig, epoch: str = "J2000") -> tuple[ObjectRecord, list[str]]` — record plus display names in `localId` order

Positions are heliocentric and rotated into the Galactic frame like every other layer, so zooming out from L0 into L1 does not rotate the sky.

- [ ] **Step 1: Write the failing test**

```python
# pipeline/tests/test_solar_system.py
import numpy as np
import pytest

from universe_pipeline.config import L0_SOLAR_SYSTEM
from universe_pipeline.records import (
    CLASS_PLANET,
    CLASS_STAR,
    FLAG_NOMINAL_MAGNITUDE,
    object_class,
)
from universe_pipeline.sources.solar_system import BODIES, build_solar_system

AU_PER_MLY = None  # unused; kept out of the test surface


def test_returns_one_record_per_body_with_matching_names() -> None:
    record, names = build_solar_system(L0_SOLAR_SYSTEM)
    assert len(record) == len(BODIES)
    assert len(names) == len(BODIES)
    assert names[0] == "Sun"
    assert "Jupiter" in names


def test_the_sun_sits_at_the_origin() -> None:
    record, names = build_solar_system(L0_SOLAR_SYSTEM)
    sun = names.index("Sun")
    assert np.linalg.norm(record.position_ly[sun]) < 1e-6


def test_planet_distances_match_their_known_orbits() -> None:
    # Semi-major axes in AU. Eccentricity means the instantaneous radius
    # differs from a, so the tolerance is generous but still discriminating:
    # a unit error or a wrong frame would be orders of magnitude out.
    expected = {
        "Mercury": 0.39, "Venus": 0.72, "Earth": 1.00, "Mars": 1.52,
        "Jupiter": 5.20, "Saturn": 9.54, "Uranus": 19.19, "Neptune": 30.07,
    }
    record, names = build_solar_system(L0_SOLAR_SYSTEM)
    for name, a in expected.items():
        r = float(np.linalg.norm(record.position_ly[names.index(name)]))
        assert r == pytest.approx(a, rel=0.15), f"{name} at {r:.3f} AU, expected about {a}"


def test_the_sun_is_a_star_and_the_rest_are_planets() -> None:
    record, names = build_solar_system(L0_SOLAR_SYSTEM)
    classes = object_class(record.type_flags)
    assert classes[names.index("Sun")] == CLASS_STAR
    assert classes[names.index("Earth")] == CLASS_PLANET


def test_magnitudes_are_marked_nominal_because_none_are_measured() -> None:
    record, _ = build_solar_system(L0_SOLAR_SYSTEM)
    assert np.all(record.type_flags & FLAG_NOMINAL_MAGNITUDE)


def test_velocities_are_real_orbital_motion_not_zero() -> None:
    record, names = build_solar_system(L0_SOLAR_SYSTEM)
    earth = names.index("Earth")
    speed = float(np.linalg.norm(record.velocity_km_s[earth]))
    # Earth orbits at about 29.8 km/s.
    assert speed == pytest.approx(29.8, rel=0.1)


def test_every_body_falls_inside_the_layer_radius() -> None:
    record, _ = build_solar_system(L0_SOLAR_SYSTEM)
    r = np.linalg.norm(record.position_ly, axis=1)
    assert np.all(r <= L0_SOLAR_SYSTEM.max_radius)


def test_positions_are_galactic_not_equatorial() -> None:
    # The ecliptic is inclined about 60 degrees to the galactic plane, so a
    # planet's galactic latitude is nowhere near zero. If the transform were
    # skipped, planets would sit close to the equatorial plane instead.
    record, names = build_solar_system(L0_SOLAR_SYSTEM)
    pos = record.position_ly[names.index("Neptune")]
    b = np.degrees(np.arcsin(pos[2] / np.linalg.norm(pos)))
    assert abs(b) > 5.0
```

- [ ] **Step 2: Run and confirm failure**

Run: `.venv/Scripts/python -m pytest pipeline/tests/test_solar_system.py -v`
Expected: `ModuleNotFoundError: No module named 'universe_pipeline.sources.solar_system'`

- [ ] **Step 3: Implement `pipeline/universe_pipeline/sources/solar_system.py`**

```python
"""Solar system bodies from astropy's built-in ephemeris."""

from __future__ import annotations

import astropy.units as u
import numpy as np
from astropy.coordinates import Galactic, SkyCoord, get_body_barycentric_posvel
from astropy.coordinates import solar_system_ephemeris
from astropy.time import Time

from universe_pipeline.config import LayerConfig
from universe_pipeline.records import (
    CLASS_PLANET,
    CLASS_STAR,
    FLAG_NOMINAL_MAGNITUDE,
    ObjectRecord,
    pack_type,
)

BODIES = (
    "sun", "mercury", "venus", "earth", "mars",
    "jupiter", "saturn", "uranus", "neptune",
)

# Planets shine by reflection and have no absolute magnitude in the stellar
# sense. This is a rendering size, flagged so the hover card says so.
NOMINAL_ABS_MAG = 1.0
NOMINAL_COLOUR = 30000


def _to_galactic(xyz_au: np.ndarray) -> np.ndarray:
    coord = SkyCoord(
        x=xyz_au[:, 0] * u.AU, y=xyz_au[:, 1] * u.AU, z=xyz_au[:, 2] * u.AU,
        representation_type="cartesian", frame="icrs",
    )
    cartesian = coord.transform_to(Galactic()).cartesian
    return np.stack(
        [cartesian.x.to_value(u.AU), cartesian.y.to_value(u.AU), cartesian.z.to_value(u.AU)],
        axis=-1,
    )


def build_solar_system(
    layer: LayerConfig, epoch: str = "J2000"
) -> tuple[ObjectRecord, list[str]]:
    when = Time(epoch)
    positions, velocities = [], []

    with solar_system_ephemeris.set("builtin"):
        sun_pos, sun_vel = get_body_barycentric_posvel("sun", when)
        for body in BODIES:
            pos, vel = get_body_barycentric_posvel(body, when)
            positions.append((pos - sun_pos).xyz.to_value(u.AU))
            velocities.append((vel - sun_vel).xyz.to_value(u.km / u.s))

    position_au = _to_galactic(np.asarray(positions, dtype=np.float64))
    velocity = _to_galactic(np.asarray(velocities, dtype=np.float64))

    n = len(BODIES)
    flags = np.array(
        [
            pack_type(CLASS_STAR if body == "sun" else CLASS_PLANET, FLAG_NOMINAL_MAGNITUDE)
            for body in BODIES
        ],
        dtype=np.uint8,
    )

    record = ObjectRecord(
        position_ly=position_au,
        velocity_km_s=velocity.astype(np.float32),
        abs_mag=np.full(n, NOMINAL_ABS_MAG, dtype=np.float32),
        colour_index=np.full(n, NOMINAL_COLOUR, dtype=np.uint16),
        type_flags=flags,
        catalog_id=np.arange(n, dtype=np.uint64),
    )
    return record, [body.capitalize() for body in BODIES]
```

`position_ly` holds AU here. The field name is a Phase 1 artefact — the array is always in the layer's own unit. Renaming it would touch every source and every test for no behavioural gain; note it and move on.

`_to_galactic` is applied to velocities too. That is correct: a rotation acts identically on position and velocity vectors, and both must land in the same frame.

- [ ] **Step 4: Run and confirm 8 pass**

Run: `.venv/Scripts/python -m pytest pipeline/tests/test_solar_system.py -v`
Expected: 8 passed.

If `test_planet_distances_match_their_known_orbits` fails by a factor near 1.5e11, the AU conversion was skipped and values are in metres. If it fails for every body by a similar rotation, `_to_galactic` is being applied twice.

- [ ] **Step 5: Commit**

```bash
.venv/Scripts/python -m ruff check pipeline
git add pipeline/universe_pipeline/sources/solar_system.py pipeline/tests/test_solar_system.py
git commit -m "feat(pipeline): add solar system bodies from the astropy ephemeris"
```

---

### Task 4: Cosmicflows-4 source

55,877 galaxies with measured distances. Peculiar velocities exist only per *group*, so an individual galaxy inherits its group's velocity — record that in the commit message, because it is a real limitation of what the catalogue knows.

VizieR is the access route rather than the Extragalactic Distance Database: `J/ApJ/944/94` is verified reachable through `astroquery.vizier`, whereas edd.ifa.hawaii.edu presents a certificate chain that fails verification.

**Files:**
- Create: `pipeline/universe_pipeline/sources/cosmicflows.py`
- Test: `pipeline/tests/test_cosmicflows.py`

**Interfaces:**
- Produces:
  - `CF4_CATALOG = "J/ApJ/944/94"`, `MPC_PER_MLY`, `NOMINAL_GALAXY_ABS_MAG = -20.5`
  - `distance_modulus_to_mpc(dm: np.ndarray) -> np.ndarray`
  - `fetch_cosmicflows(cache_dir: Path) -> dict[str, np.ndarray]` — the only networked function
  - `normalise_cosmicflows(table: Mapping[str, np.ndarray], layer: LayerConfig) -> tuple[ObjectRecord, list[str]]`

The table passed to `normalise_cosmicflows` carries the joined columns `ra`, `dec`, `dm`, `pgc`, `vpec` (NaN where the galaxy's group has no measured peculiar velocity).

- [ ] **Step 1: Write the failing test**

```python
# pipeline/tests/test_cosmicflows.py
import numpy as np
import pytest

from universe_pipeline.config import L3_LOCAL_UNIVERSE
from universe_pipeline.records import (
    CLASS_GALAXY,
    FLAG_NOMINAL_MAGNITUDE,
    FLAG_NO_RADIAL_VELOCITY,
    object_class,
)
from universe_pipeline.sources.cosmicflows import (
    distance_modulus_to_mpc,
    normalise_cosmicflows,
)


def sample(**overrides: np.ndarray) -> dict[str, np.ndarray]:
    table = {
        # DM 31.0 -> 15.85 Mpc -> 51.7 Mly, comfortably inside the layer.
        "ra": np.array([266.40510, 10.0, 200.0, 45.0]),
        "dec": np.array([-28.93617, 20.0, -40.0, 10.0]),
        "dm": np.array([31.0, 33.0, 39.5, 18.0]),
        "pgc": np.array([1, 2, 3, 4], dtype=np.uint64),
        "vpec": np.array([250.0, np.nan, 100.0, 0.0]),
    }
    table.update(overrides)
    return table


def test_distance_modulus_matches_the_standard_relation() -> None:
    # DM = 5*log10(d_pc) - 5, so d_Mpc = 10**((DM - 25) / 5).
    np.testing.assert_allclose(
        distance_modulus_to_mpc(np.array([25.0, 30.0, 35.0])),
        np.array([1.0, 10.0, 100.0]),
        rtol=1e-9,
    )


def test_drops_galaxies_outside_the_layer_range() -> None:
    record, _ = normalise_cosmicflows(sample(), L3_LOCAL_UNIVERSE)
    # DM 39.5 is about 2600 Mly (beyond 300) and DM 18.0 about 0.13 Mly
    # (inside 0.3), so only the first two survive.
    assert len(record) == 2


def test_places_the_galactic_centre_direction_on_positive_x() -> None:
    record, _ = normalise_cosmicflows(sample(), L3_LOCAL_UNIVERSE)
    unit = record.position_ly[0] / np.linalg.norm(record.position_ly[0])
    np.testing.assert_allclose(unit, np.array([1.0, 0.0, 0.0]), atol=1e-5)


def test_distance_is_expressed_in_the_layer_unit() -> None:
    record, _ = normalise_cosmicflows(sample(), L3_LOCAL_UNIVERSE)
    # 15.85 Mpc * 3.2616 Mly/Mpc = 51.7 Mly
    assert float(np.linalg.norm(record.position_ly[0])) == pytest.approx(51.7, rel=0.01)


def test_peculiar_velocity_is_radial_because_that_is_all_the_catalogue_knows() -> None:
    record, _ = normalise_cosmicflows(sample(), L3_LOCAL_UNIVERSE)
    direction = record.position_ly[0] / np.linalg.norm(record.position_ly[0])
    np.testing.assert_allclose(record.velocity_km_s[0], direction * 250.0, rtol=1e-4)


def test_missing_peculiar_velocity_is_flagged_not_assumed_zero() -> None:
    record, _ = normalise_cosmicflows(sample(), L3_LOCAL_UNIVERSE)
    assert not record.type_flags[0] & FLAG_NO_RADIAL_VELOCITY
    assert record.type_flags[1] & FLAG_NO_RADIAL_VELOCITY
    assert np.all(np.isfinite(record.velocity_km_s))


def test_everything_is_a_galaxy_with_a_nominal_magnitude() -> None:
    record, _ = normalise_cosmicflows(sample(), L3_LOCAL_UNIVERSE)
    assert np.all(object_class(record.type_flags) == CLASS_GALAXY)
    assert np.all(record.type_flags & FLAG_NOMINAL_MAGNITUDE)


def test_names_carry_the_pgc_identifier_in_local_id_order() -> None:
    record, names = normalise_cosmicflows(sample(), L3_LOCAL_UNIVERSE)
    assert len(names) == len(record)
    assert names[0] == "PGC 1"
```

- [ ] **Step 2: Run and confirm failure**

Run: `.venv/Scripts/python -m pytest pipeline/tests/test_cosmicflows.py -v`
Expected: `ModuleNotFoundError`.

- [ ] **Step 3: Implement `pipeline/universe_pipeline/sources/cosmicflows.py`**

```python
"""Cosmicflows-4 galaxies from VizieR catalogue J/ApJ/944/94."""

from __future__ import annotations

from collections.abc import Mapping
from pathlib import Path

import numpy as np

from universe_pipeline.config import LayerConfig
from universe_pipeline.frames import icrs_to_galactic_cartesian
from universe_pipeline.records import (
    CLASS_GALAXY,
    FLAG_NOMINAL_MAGNITUDE,
    FLAG_NO_RADIAL_VELOCITY,
    ObjectRecord,
    pack_type,
)
from universe_pipeline.sources.gaia import write_cache_atomic

CF4_CATALOG = "J/ApJ/944/94"
MLY_PER_MPC = 3.261563777167433
PC_PER_MPC = 1.0e6

# CF4 carries no photometry, so brightness is a rendering choice and is
# flagged as such rather than presented as a measurement.
NOMINAL_GALAXY_ABS_MAG = -20.5
NOMINAL_GALAXY_COLOUR = 42000


def distance_modulus_to_mpc(dm: np.ndarray) -> np.ndarray:
    return 10.0 ** ((np.asarray(dm, dtype=np.float64) - 25.0) / 5.0)


def fetch_cosmicflows(cache_dir: Path) -> dict[str, np.ndarray]:
    """Individual galaxies joined to their group's peculiar velocity."""
    cached = cache_dir / "cosmicflows4.npz"
    if cached.exists():
        with np.load(cached) as data:
            return {key: data[key] for key in data.files}

    from astroquery.vizier import Vizier

    vizier = Vizier(columns=["**"], row_limit=-1)
    tables = vizier.get_catalogs(CF4_CATALOG)
    galaxies = tables[f"{CF4_CATALOG}/table2"]
    groups = tables[f"{CF4_CATALOG}/groups"]

    # Peculiar velocity is measured per group, so a galaxy inherits its
    # group's value. Galaxies whose group has none keep NaN.
    group_id = np.asarray(groups["1PGC"], dtype=np.int64)
    group_vpec = np.asarray(groups["Vpec"], dtype=np.float64)
    order = np.argsort(group_id)
    keys, values = group_id[order], group_vpec[order]

    galaxy_group = np.asarray(galaxies["1PGC"], dtype=np.int64)
    slot = np.searchsorted(keys, galaxy_group)
    slot = np.clip(slot, 0, len(keys) - 1)
    matched = keys[slot] == galaxy_group
    vpec = np.where(matched, values[slot], np.nan)

    arrays = {
        "ra": np.asarray(galaxies["RAJ2000"], dtype=np.float64),
        "dec": np.asarray(galaxies["DEJ2000"], dtype=np.float64),
        "dm": np.asarray(galaxies["DM"], dtype=np.float64),
        "pgc": np.asarray(galaxies["PGC"], dtype=np.uint64),
        "vpec": vpec,
    }
    cache_dir.mkdir(parents=True, exist_ok=True)
    write_cache_atomic(cached, arrays)
    return arrays


def normalise_cosmicflows(
    table: Mapping[str, np.ndarray], layer: LayerConfig
) -> tuple[ObjectRecord, list[str]]:
    dm = np.asarray(table["dm"], dtype=np.float64)
    distance_mly = distance_modulus_to_mpc(dm) * MLY_PER_MPC

    keep = np.isfinite(distance_mly)
    keep &= distance_mly >= layer.min_radius
    keep &= distance_mly <= layer.max_radius

    ra = np.asarray(table["ra"], dtype=np.float64)[keep]
    dec = np.asarray(table["dec"], dtype=np.float64)[keep]
    distance_mly = distance_mly[keep]

    # icrs_to_galactic_cartesian works in parsecs; feed it the distance in Mpc
    # scaled to pc, then convert the result back to the layer unit.
    distance_pc = distance_mly / MLY_PER_MPC * PC_PER_MPC
    position = icrs_to_galactic_cartesian(ra, dec, distance_pc) / PC_PER_MPC * MLY_PER_MPC

    raw_vpec = np.asarray(table["vpec"], dtype=np.float64)[keep]
    missing = ~np.isfinite(raw_vpec)
    vpec = np.nan_to_num(raw_vpec, nan=0.0)

    radial = position / np.maximum(
        np.linalg.norm(position, axis=1, keepdims=True), 1e-12
    )
    velocity = radial * vpec[:, None]

    n = int(keep.sum())
    flags = np.full(n, pack_type(CLASS_GALAXY, FLAG_NOMINAL_MAGNITUDE), dtype=np.uint8)
    flags[missing] |= FLAG_NO_RADIAL_VELOCITY

    pgc = np.asarray(table["pgc"], dtype=np.uint64)[keep]
    record = ObjectRecord(
        position_ly=position,
        velocity_km_s=velocity.astype(np.float32),
        abs_mag=np.full(n, NOMINAL_GALAXY_ABS_MAG, dtype=np.float32),
        colour_index=np.full(n, NOMINAL_GALAXY_COLOUR, dtype=np.uint16),
        type_flags=flags,
        catalog_id=pgc,
    )
    return record, [f"PGC {int(p)}" for p in pgc]
```

- [ ] **Step 4: Run and confirm 8 pass**

Run: `.venv/Scripts/python -m pytest pipeline/tests/test_cosmicflows.py -v`
Expected: 8 passed.

Do NOT call `fetch_cosmicflows` in any test — every test above runs on in-memory arrays.

- [ ] **Step 5: Commit**

```bash
.venv/Scripts/python -m ruff check pipeline
git add pipeline/universe_pipeline/sources/cosmicflows.py pipeline/tests/test_cosmicflows.py
git commit -m "feat(pipeline): add Cosmicflows-4 galaxies from VizieR"
```

---

### Task 5: Multi-layer CLI, name sidecars, and rebake

**Files:**
- Modify: `pipeline/universe_pipeline/build.py`
- Modify: `pipeline/universe_pipeline/cli.py`
- Modify: `pipeline/tests/test_build.py`

**Interfaces:**
- `build_layer(record, layer, out_dir, names: list[str] | None = None) -> dict` — writes `names.json` when names are given, and adds `"origin"` and `"idPrefix"` to `tileset.json`
- CLI: `--layer` accepts `solar-system`, `stellar-neighbourhood`, `local-universe`; `--all` bakes every layer

`names.json` maps `localId` to a display name. It exists for small layers only; L1's 33 million names are a Phase 3 sidecar problem and the app must treat a 404 as "no names".

- [ ] **Step 1: Add the name sidecar test**

```python
# append to pipeline/tests/test_build.py

def test_names_are_written_in_local_id_order(tmp_path: Path) -> None:
    record = synthetic_record(5)
    names = [f"body {i}" for i in range(5)]

    build_layer(record, L1_STELLAR_NEIGHBOURHOOD, tmp_path, names=names)

    written = json.loads(
        (tmp_path / "stellar-neighbourhood" / "names.json").read_text(encoding="utf-8")
    )
    assert written["3"] == "body 3"
    assert len(written) == 5


def test_no_names_file_when_none_are_supplied(tmp_path: Path) -> None:
    build_layer(synthetic_record(5), L1_STELLAR_NEIGHBOURHOOD, tmp_path)
    assert not (tmp_path / "stellar-neighbourhood" / "names.json").exists()


def test_tileset_records_the_origin_and_identifier_prefix(tmp_path: Path) -> None:
    tileset = build_layer(synthetic_record(3), L1_STELLAR_NEIGHBOURHOOD, tmp_path)
    assert tileset["origin"] == L1_STELLAR_NEIGHBOURHOOD.origin
    assert "idPrefix" in tileset
```

- [ ] **Step 2: Run and confirm failure**

Run: `.venv/Scripts/python -m pytest pipeline/tests/test_build.py -v`
Expected: the three new tests fail; the existing five still pass.

- [ ] **Step 3: Extend `build_layer` in `pipeline/universe_pipeline/build.py`**

Add `names: list[str] | None = None` and `id_prefix: str = ""` parameters. After writing `ids.bin`:

```python
    if names is not None:
        (layer_dir / "names.json").write_text(
            json.dumps({str(i): name for i, name in enumerate(names)}), encoding="utf-8"
        )
```

Add `"origin": layer.origin` and `"idPrefix": id_prefix` to the returned `tileset` dictionary, and extend `_clear_previous_bake` to remove a stale `names.json`.

- [ ] **Step 4: Rewrite the CLI dispatch in `pipeline/universe_pipeline/cli.py`**

Replace the `LAYERS` constant with an import from `config`, and replace the body of `main` after `layer = LAYERS[args.layer]` with a per-layer dispatch:

```python
def _build_one(key: str, args: argparse.Namespace) -> None:
    layer = LAYERS[key]
    names: list[str] | None = None
    prefix = ""

    if args.synthetic is not None:
        record = _synthetic(args.synthetic, layer, seed=1)
    elif key == "solar-system":
        record, names = build_solar_system(layer)
        prefix = "Body"
    elif key == "local-universe":
        record, names = normalise_cosmicflows(fetch_cosmicflows(args.cache), layer)
        prefix = "PGC"
    elif key == "stellar-neighbourhood":
        record = _concat(fetch_layer_chunks(layer, args.chunks, args.cache, args.workers))
        prefix = "Gaia DR3"
    else:
        raise SystemExit(f"no source wired for layer {key}")

    print(f"{key}: {len(record)} objects", flush=True)
    tileset = build_layer(record, layer, args.out, names=names, id_prefix=prefix)

    tiles, stack = 0, [tileset["root"]]
    while stack:
        node = stack.pop()
        tiles += 1
        stack.extend(node["children"])
    print(f"wrote {tiles} tiles to {args.out / key}", flush=True)
```

Add an `--all` flag and drive `_build_one` over either `[args.layer]` or `sorted(LAYERS)`.

- [ ] **Step 5: Bake the two new layers and rebake L1**

L1 must be rebaked because Task 1 changed how `typeFlags` encodes class and flags — its existing tiles carry the old meaning. The Gaia download is fully cached, so this re-runs the bake only.

```bash
.venv/Scripts/python -m universe_pipeline.cli --layer solar-system
.venv/Scripts/python -m universe_pipeline.cli --layer local-universe
.venv/Scripts/python -m universe_pipeline.cli --layer stellar-neighbourhood
```

Expected: nine bodies; roughly 40,000–50,000 galaxies inside 300 Mly; 32,750,394 stars unchanged in count.

Report the object count, tile count and directory size for each.

- [ ] **Step 6: Verify the new layers look physically right**

```bash
.venv/Scripts/python - <<'EOF'
import glob, json
import numpy as np
from universe_pipeline.tileformat import decode_tile
from universe_pipeline.records import object_class

for key in ("solar-system", "local-universe"):
    d = f"public/data/{key}"
    ts = json.load(open(f"{d}/tileset.json"))
    pos = []
    for f in sorted(glob.glob(f"{d}/r*.bin"))[:60]:
        p, _, _ = decode_tile(open(f, "rb").read())
        if len(p): pos.append(p.position)
    pos = np.concatenate(pos)
    r = np.linalg.norm(pos, axis=1)
    print(f"{key}: {ts['pointCount']} objects, unit={ts['unit']}, "
          f"r={r.min():.3f}..{r.max():.1f} {ts['unit']}")
EOF
```

Sanity: solar-system radii run 0 to about 30 AU; local-universe runs 0.3 to 300 Mly.

- [ ] **Step 7: Commit**

```bash
.venv/Scripts/python -m pytest pipeline/tests -q
.venv/Scripts/python -m ruff check pipeline
git add pipeline/universe_pipeline/build.py pipeline/universe_pipeline/cli.py pipeline/tests/test_build.py
git commit -m "feat(pipeline): bake any layer from the CLI with name sidecars"
```

---

### Task 6: Layer stack — pure selection and rescaling

The whole scale ladder reduces to two pure questions: which layer or pair of layers is active at a given distance, and how a camera position converts between two layers' units. Both are pure functions, so both get real tests before any rendering exists.

**A gap, not an overlap.** The spec assumes adjacent layers overlap, but L2 is a later phase, so L1 ends at 5,000 ly and L3 begins at 300,000 ly with nothing between. The selection logic must treat a gap exactly as it treats an overlap — a band across which one layer fades out and the next fades in. Blending in log space, because a linear ramp across two decades would spend almost the whole transition looking like the outer layer.

**Files:**
- Create: `app/src/layers/registry.ts`, `app/src/layers/stack.ts`, `app/src/layers/stack.test.ts`

**Interfaces:**
- Produces:
  - `interface LayerDef { key: string; url: string; unit: string; unitInMetres: number; minRadius: number; maxRadius: number; origin: string }`
  - `LAYERS: LayerDef[]` in `registry.ts`, ordered inner to outer
  - `interface LayerSelection { primary: LayerDef; secondary: LayerDef | null; blend: number }`
  - `selectLayers(distanceMetres: number, layers: LayerDef[]): LayerSelection`
  - `rescalePosition(distance: number, fromUnitInMetres: number, toUnitInMetres: number): number`
  - `layerScaleFactor(layer: LayerDef, active: LayerDef): number`

`blend` is 0 when the view is entirely `primary` and rises to 1 at the point where `secondary` fully takes over. `secondary` is `null` outside a transition band.

- [ ] **Step 1: Write the failing tests**

```typescript
// app/src/layers/stack.test.ts
import { describe, expect, it } from 'vitest';
import { layerScaleFactor, rescalePosition, selectLayers, type LayerDef } from './stack.js';

const AU = 149597870700;
const LY = 9460730472580800;
const MLY = LY * 1e6;

const layers: LayerDef[] = [
  { key: 'solar-system', url: '/a', unit: 'AU', unitInMetres: AU, minRadius: 0, maxRadius: 100, origin: 'Sun' },
  { key: 'stellar', url: '/b', unit: 'ly', unitInMetres: LY, minRadius: 0.01, maxRadius: 5000, origin: 'Sol' },
  { key: 'local', url: '/c', unit: 'Mly', unitInMetres: MLY, minRadius: 0.3, maxRadius: 300, origin: 'MW' },
];

describe('selectLayers', () => {
  it('picks the innermost layer close to the origin', () => {
    const s = selectLayers(5 * AU, layers);
    expect(s.primary.key).toBe('solar-system');
    expect(s.secondary).toBeNull();
    expect(s.blend).toBe(0);
  });

  it('picks the middle layer well inside its range', () => {
    const s = selectLayers(1000 * LY, layers);
    expect(s.primary.key).toBe('stellar');
    expect(s.secondary).toBeNull();
  });

  it('picks the outermost layer at great distance', () => {
    const s = selectLayers(200 * MLY, layers);
    expect(s.primary.key).toBe('local');
    expect(s.secondary).toBeNull();
  });

  it('blends across the gap between two layers', () => {
    // 5000 ly is the top of the stellar layer, 300000 ly the bottom of local.
    const s = selectLayers(30000 * LY, layers);
    expect(s.primary.key).toBe('stellar');
    expect(s.secondary?.key).toBe('local');
    expect(s.blend).toBeGreaterThan(0);
    expect(s.blend).toBeLessThan(1);
  });

  it('blends in log space so the transition is even across decades', () => {
    // The geometric midpoint of 5000 and 300000 ly should be blend 0.5.
    const midpoint = Math.sqrt(5000 * 300000) * LY;
    expect(selectLayers(midpoint, layers).blend).toBeCloseTo(0.5, 2);
  });

  it('is monotonic: blend never decreases as distance grows', () => {
    let previous = -1;
    for (let d = 5000; d <= 300000; d *= 1.2) {
      const s = selectLayers(d * LY, layers);
      expect(s.blend).toBeGreaterThanOrEqual(previous);
      previous = s.blend;
    }
  });

  it('clamps below the innermost layer rather than returning nothing', () => {
    const s = selectLayers(0, layers);
    expect(s.primary.key).toBe('solar-system');
  });

  it('clamps beyond the outermost layer', () => {
    const s = selectLayers(1e9 * MLY, layers);
    expect(s.primary.key).toBe('local');
    expect(s.secondary).toBeNull();
  });

  it('never returns a blend outside 0 to 1', () => {
    for (const d of [0, AU, LY, 1e4 * LY, 1e5 * LY, MLY, 1e4 * MLY]) {
      const s = selectLayers(d, layers);
      expect(s.blend).toBeGreaterThanOrEqual(0);
      expect(s.blend).toBeLessThanOrEqual(1);
    }
  });
});

describe('rescalePosition', () => {
  it('converts a distance between two units', () => {
    // 1 light-year expressed in AU is about 63241.
    expect(rescalePosition(1, LY, AU)).toBeCloseTo(63241, 0);
  });

  it('round-trips without drift', () => {
    const there = rescalePosition(1234.5, LY, AU);
    expect(rescalePosition(there, AU, LY)).toBeCloseTo(1234.5, 6);
  });

  it('is the identity for the same unit', () => {
    expect(rescalePosition(42, LY, LY)).toBe(42);
  });
});

describe('layerScaleFactor', () => {
  it('is 1 for the active layer itself', () => {
    expect(layerScaleFactor(layers[1]!, layers[1]!)).toBe(1);
  });

  it('shrinks an outer layer into an inner layer active space', () => {
    // A megalight-year is a million light-years, so drawing the local layer
    // inside the stellar layer scales its coordinates up by 1e6.
    expect(layerScaleFactor(layers[2]!, layers[1]!)).toBeCloseTo(1e6, 0);
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run app/src/layers/stack.test.ts`
Expected: cannot resolve `./stack.js`.

- [ ] **Step 3: Implement `app/src/layers/stack.ts`**

```typescript
export interface LayerDef {
  key: string;
  url: string;
  unit: string;
  unitInMetres: number;
  minRadius: number;
  maxRadius: number;
  origin: string;
}

export interface LayerSelection {
  primary: LayerDef;
  secondary: LayerDef | null;
  blend: number;
}

const outerEdge = (layer: LayerDef): number => layer.maxRadius * layer.unitInMetres;
const innerEdge = (layer: LayerDef): number => layer.minRadius * layer.unitInMetres;

export function rescalePosition(
  distance: number,
  fromUnitInMetres: number,
  toUnitInMetres: number,
): number {
  return fromUnitInMetres === toUnitInMetres
    ? distance
    : (distance * fromUnitInMetres) / toUnitInMetres;
}

export function layerScaleFactor(layer: LayerDef, active: LayerDef): number {
  return layer.unitInMetres / active.unitInMetres;
}

export function selectLayers(distanceMetres: number, layers: LayerDef[]): LayerSelection {
  const first = layers[0]!;
  const last = layers[layers.length - 1]!;

  if (distanceMetres <= outerEdge(first)) return { primary: first, secondary: null, blend: 0 };
  if (distanceMetres >= innerEdge(last)) {
    const inLast = distanceMetres >= innerEdge(last);
    if (inLast && layers.length === 1) return { primary: last, secondary: null, blend: 0 };
  }

  for (let i = 0; i < layers.length - 1; i++) {
    const inner = layers[i]!;
    const outer = layers[i + 1]!;
    const bandStart = outerEdge(inner);
    const bandEnd = innerEdge(outer);

    if (distanceMetres <= bandStart) return { primary: inner, secondary: null, blend: 0 };
    if (distanceMetres < bandEnd) {
      // Log space: a linear ramp across two decades would read as the outer
      // layer for almost the whole transition.
      const blend =
        (Math.log(distanceMetres) - Math.log(bandStart)) /
        (Math.log(bandEnd) - Math.log(bandStart));
      return { primary: inner, secondary: outer, blend: Math.min(Math.max(blend, 0), 1) };
    }
  }

  return { primary: last, secondary: null, blend: 0 };
}
```

- [ ] **Step 4: Create `app/src/layers/registry.ts`**

```typescript
import type { LayerDef } from './stack.js';

const LY_IN_METRES = 9460730472580800;

// Ordered inner to outer. Must agree with pipeline/universe_pipeline/config.py.
export const LAYERS: LayerDef[] = [
  {
    key: 'solar-system',
    url: '/data/solar-system',
    unit: 'AU',
    unitInMetres: 149597870700,
    minRadius: 0,
    maxRadius: 100,
    origin: 'Sun',
  },
  {
    key: 'stellar-neighbourhood',
    url: '/data/stellar-neighbourhood',
    unit: 'ly',
    unitInMetres: LY_IN_METRES,
    minRadius: 0.01,
    maxRadius: 5000,
    origin: 'Sol',
  },
  {
    key: 'local-universe',
    url: '/data/local-universe',
    unit: 'Mly',
    unitInMetres: LY_IN_METRES * 1e6,
    minRadius: 0.3,
    maxRadius: 300,
    origin: 'Milky Way',
  },
];
```

- [ ] **Step 5: Run and confirm all pass**

Run: `npx vitest run app/src/layers/stack.test.ts`
Expected: 14 passed.

- [ ] **Step 6: Commit**

```bash
npm run typecheck && npm run lint
git add app/src/layers/
git commit -m "feat(app): add pure layer selection and unit rescaling"
```

---

### Task 7: Per-layer renderer and crossfade

**Files:**
- Modify: `app/src/render/pointMaterial.ts` — add `uLayerOpacity`
- Create: `app/src/layers/layerRenderer.ts`
- Test: `app/src/layers/layerRenderer.test.ts`

**Interfaces:**
- Consumes: `LayerDef`, `layerScaleFactor` from Task 6; `TileManager`, `fetchTileset`, `createPointMaterial`.
- Produces:
  - `class LayerRenderer` — `static create(def: LayerDef, unitInParsecs: number): Promise<LayerRenderer>`, `readonly def: LayerDef`, `readonly group: Group`, `readonly manager: TileManager`, `readonly tileset: Tileset`, `setOpacity(value: number): void`, `applyActiveLayer(active: LayerDef): void`, `update(view: ViewState): void`, `dispose(): void`
  - `opacityForBlend(role: 'primary' | 'secondary', blend: number): number`

`opacityForBlend` is the pure part and carries the tests. A layer at opacity 0 must also stop updating, or an invisible layer keeps streaming tiles and competing for the request budget.

- [ ] **Step 1: Add the opacity uniform to `app/src/render/pointMaterial.ts`**

Add `uLayerOpacity: { value: 1 }` to the uniforms, declare `uniform float uLayerOpacity;` in the fragment shader, and multiply it into the output:

```glsl
  fragColour = vec4(tint * falloff * vAlpha * uLayerOpacity, 1.0);
```

Multiplying into the colour rather than alpha is correct here because the material blends additively — a layer at zero opacity then contributes nothing, which is exactly what fading out means.

- [ ] **Step 2: Write the failing test**

```typescript
// app/src/layers/layerRenderer.test.ts
import { describe, expect, it } from 'vitest';
import { opacityForBlend } from './layerRenderer.js';

describe('opacityForBlend', () => {
  it('shows the primary fully when there is no transition', () => {
    expect(opacityForBlend('primary', 0)).toBe(1);
    expect(opacityForBlend('secondary', 0)).toBe(0);
  });

  it('hands over completely at the end of the band', () => {
    expect(opacityForBlend('primary', 1)).toBe(0);
    expect(opacityForBlend('secondary', 1)).toBe(1);
  });

  it('crosses over at the midpoint', () => {
    expect(opacityForBlend('primary', 0.5)).toBeCloseTo(0.5);
    expect(opacityForBlend('secondary', 0.5)).toBeCloseTo(0.5);
  });

  it('keeps total brightness roughly constant across the band', () => {
    // Additive blending means the two opacities summing to 1 avoids a bright
    // or dark seam midway through the transition.
    for (let b = 0; b <= 1; b += 0.1) {
      expect(opacityForBlend('primary', b) + opacityForBlend('secondary', b)).toBeCloseTo(1, 6);
    }
  });

  it('never returns a value outside 0 to 1', () => {
    for (const b of [-1, 0, 0.3, 1, 2]) {
      for (const role of ['primary', 'secondary'] as const) {
        const v = opacityForBlend(role, b);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });
});
```

- [ ] **Step 3: Run and confirm failure**

Run: `npx vitest run app/src/layers/layerRenderer.test.ts`
Expected: cannot resolve `./layerRenderer.js`.

- [ ] **Step 4: Implement `app/src/layers/layerRenderer.ts`**

```typescript
import { Group } from 'three';
import { createPointMaterial } from '../render/pointMaterial.js';
import { TileManager } from '../tiles/tileManager.js';
import { fetchTileset, type Tileset } from '../tiles/tileset.js';
import type { ViewState } from '../tiles/traversal.js';
import { layerScaleFactor, type LayerDef } from './stack.js';

export function opacityForBlend(role: 'primary' | 'secondary', blend: number): number {
  const clamped = Math.min(Math.max(blend, 0), 1);
  return role === 'primary' ? 1 - clamped : clamped;
}

export class LayerRenderer {
  readonly group = new Group();
  private opacity = 1;

  private constructor(
    readonly def: LayerDef,
    readonly tileset: Tileset,
    readonly manager: TileManager,
    private readonly material: ReturnType<typeof createPointMaterial>,
  ) {
    this.group.add(manager.group);
  }

  static async create(def: LayerDef, unitInParsecs: number): Promise<LayerRenderer> {
    const tileset = await fetchTileset(def.url);
    const material = createPointMaterial(unitInParsecs);
    const manager = new TileManager(def.url, tileset, material);
    return new LayerRenderer(def, tileset, manager, material);
  }

  setOpacity(value: number): void {
    this.opacity = Math.min(Math.max(value, 0), 1);
    this.group.visible = this.opacity > 0;
    for (const mesh of this.manager.meshes.values()) {
      if (Array.isArray(mesh.material)) continue;
      const uniform = (mesh.material as typeof this.material).uniforms['uLayerOpacity'];
      if (uniform) uniform.value = this.opacity;
    }
    // Tiles that stream in later must inherit the current opacity.
    const base = this.material.uniforms['uLayerOpacity'];
    if (base) base.value = this.opacity;
  }

  applyActiveLayer(active: LayerDef): void {
    const scale = layerScaleFactor(this.def, active);
    this.group.scale.setScalar(scale);
  }

  update(view: ViewState): void {
    // An invisible layer must not stream: it would compete for the eight
    // in-flight slots with the layer actually on screen.
    if (this.opacity <= 0) return;
    this.manager.update(view);
  }

  dispose(): void {
    this.manager.dispose();
  }
}
```

- [ ] **Step 5: Run, verify, commit**

Run: `npx vitest run app/src/layers/layerRenderer.test.ts` → 5 passed.

```bash
npm run typecheck && npm run lint && npx vitest run
git add app/src/layers/layerRenderer.ts app/src/layers/layerRenderer.test.ts app/src/render/pointMaterial.ts
git commit -m "feat(app): add per-layer renderer with crossfade opacity"
```

---

### Task 8: Compose the layers and prove a boundary crossing

**Files:**
- Modify: `app/src/main.ts`
- Modify: `e2e/render.spec.ts`

**Interfaces:**
- `window.__universeMap` gains `layers: LayerRenderer[]`, `selection: () => LayerSelection`, and `activeLayer: () => LayerDef`. Existing fields keep their meaning, with `manager` and `tileset` referring to the **currently primary** layer so the Phase 1 tests keep working.

**Camera handover.** The camera position is in the active layer's units. When the primary layer changes, rescale it once:

```
newPosition = oldPosition * (oldUnitInMetres / newUnitInMetres)
```

Do this only on a change of primary, never per frame — repeating it every frame would compound floating-point error into visible drift.

- [ ] **Step 1: Rewrite `app/src/main.ts`**

```typescript
import { Vector3 } from 'three';
import { Viewer } from './core/viewer.js';
import { Anchor } from './interaction/anchors.js';
import { HoverController } from './interaction/hover.js';
import { LayerRenderer, opacityForBlend } from './layers/layerRenderer.js';
import { LAYERS } from './layers/registry.js';
import { rescalePosition, selectLayers, type LayerDef, type LayerSelection } from './layers/stack.js';
import { PickingPass } from './render/picking.js';
import { TileManager } from './tiles/tileManager.js';
import type { Tileset } from './tiles/tileset.js';
import { HoverCard } from './ui/hoverCard.js';

const PARSECS_PER_LIGHT_YEAR = 1 / 3.261563777167433;
const METRES_PER_PARSEC = 3.0856775814913673e16;

declare global {
  interface Window {
    __universeMap?: {
      viewer: Viewer;
      manager: TileManager;
      tileset: Tileset;
      frameTimes: number[];
      picking: PickingPass;
      hover: HoverController;
      identifiersReady: Promise<void>;
      layers: LayerRenderer[];
      selection: () => LayerSelection;
      activeLayer: () => LayerDef;
    };
  }
}

async function loadNames(url: string): Promise<Map<number, string>> {
  const response = await fetch(`${url}/names.json`);
  if (!response.ok) return new Map();
  const raw = (await response.json()) as Record<string, string>;
  return new Map(Object.entries(raw).map(([k, v]) => [Number(k), v]));
}

async function loadIdentifiers(url: string): Promise<BigUint64Array | undefined> {
  const response = await fetch(`${url}/ids.bin`);
  if (!response.ok) return undefined;
  return new BigUint64Array(await response.arrayBuffer());
}

async function boot(): Promise<void> {
  const viewer = new Viewer(document.body);

  const renderers = await Promise.all(
    LAYERS.map((def) =>
      LayerRenderer.create(def, (def.unitInMetres / METRES_PER_PARSEC) * 1),
    ),
  );
  for (const renderer of renderers) viewer.add(renderer.group);

  const names = new Map<string, Map<number, string>>();
  const identifiers = new Map<string, BigUint64Array>();
  const identifiersReady = Promise.all(
    LAYERS.map(async (def) => {
      names.set(def.key, await loadNames(def.url));
      const ids = await loadIdentifiers(def.url);
      if (ids) identifiers.set(def.key, ids);
    }),
  ).then(() => undefined);

  let active = renderers[1]!.def;
  viewer.camera.position.set(0, 0, 3000);

  const picking = new PickingPass(viewer.renderer, viewer.scene, viewer.camera);
  const card = new HoverCard(document.body);
  let primary = renderers[1]!;

  const hover = new HoverController(
    picking,
    card,
    {
      get unit() {
        return primary.def.unit;
      },
      tileForSlot: (slot) => primary.manager.tilesBySlot.get(slot),
      catalogId: (tile, index) => {
        const local = tile.localId[index];
        if (local === undefined) return undefined;
        const named = names.get(primary.def.key)?.get(local);
        if (named !== undefined) return named;
        return identifiers.get(primary.def.key)?.[local];
      },
    },
    viewer.renderer.domElement,
  );

  const earth = new Anchor('Earth', new Vector3(0, 0, 0), document.body);
  const milkyWay = new Anchor('Milky Way', new Vector3(0, 0, 0), document.body);

  let selection = selectLayers(0, LAYERS);
  const frameTimes: number[] = [];

  viewer.onFrame((dt) => {
    frameTimes.push(dt * 1000);
    if (frameTimes.length > 600) frameTimes.shift();

    const distanceMetres = viewer.camera.position.length() * active.unitInMetres;
    selection = selectLayers(distanceMetres, LAYERS);

    if (selection.primary.key !== active.key) {
      // Hand the camera over once, on change only. Doing this per frame would
      // compound rounding into visible drift.
      const scaled = rescalePosition(
        viewer.camera.position.length(),
        active.unitInMetres,
        selection.primary.unitInMetres,
      );
      viewer.camera.position.setLength(scaled);
      active = selection.primary;
    }

    primary = renderers.find((r) => r.def.key === selection.primary.key) ?? primary;

    for (const renderer of renderers) {
      renderer.applyActiveLayer(active);
      if (renderer.def.key === selection.primary.key) {
        renderer.setOpacity(opacityForBlend('primary', selection.secondary ? selection.blend : 0));
      } else if (renderer.def.key === selection.secondary?.key) {
        renderer.setOpacity(opacityForBlend('secondary', selection.blend));
      } else {
        renderer.setOpacity(0);
      }
      renderer.update({
        position: viewer.camera.position,
        screenHeight: viewer.renderer.domElement.height,
        fovRadians: (viewer.camera.fov * Math.PI) / 180,
      });
    }

    earth.update(viewer.camera, window.innerWidth, window.innerHeight);
    milkyWay.update(viewer.camera, window.innerWidth, window.innerHeight);
  });

  viewer.start();
  window.__universeMap = {
    viewer,
    get manager() {
      return primary.manager;
    },
    get tileset() {
      return primary.tileset;
    },
    frameTimes,
    picking,
    hover,
    identifiersReady,
    layers: renderers,
    selection: () => selection,
    activeLayer: () => active,
  };
  console.info(`layers loaded: ${renderers.map((r) => r.def.key).join(', ')}`);
}

void boot();
```

`renderer.update` is called for every layer, but `LayerRenderer.update` returns immediately at zero opacity, so hidden layers cost nothing.

- [ ] **Step 2: Add the boundary-crossing e2e test**

Append to `e2e/render.spec.ts`:

```typescript
test('crosses from the stellar layer out to the local universe', async ({ page }) => {
  const start = await page.evaluate(() => window.__universeMap!.activeLayer().key);
  expect(start).toBe('stellar-neighbourhood');

  const crossing = await page.evaluate(async () => {
    const { viewer, selection, activeLayer } = window.__universeMap!;
    const seen: { key: string; blend: number }[] = [];
    // Sweep outward through the transition band and record what the stack does.
    for (const distance of [3000, 30000, 300000, 3e6, 3e7, 1e8]) {
      viewer.camera.position.set(0, 0, distance);
      await new Promise((r) => requestAnimationFrame(r));
      await new Promise((r) => requestAnimationFrame(r));
      seen.push({ key: activeLayer().key, blend: selection().blend });
    }
    return { seen, end: activeLayer().key };
  });

  // Somewhere in the sweep both layers must be partly visible.
  expect(crossing.seen.some((s) => s.blend > 0 && s.blend < 1)).toBe(true);
  expect(crossing.end).toBe('local-universe');
});

test('shows the solar system when the camera is close to the Sun', async ({ page }) => {
  const key = await page.evaluate(async () => {
    const { viewer, activeLayer } = window.__universeMap!;
    viewer.camera.position.set(0, 0, 1e-6);
    await new Promise((r) => requestAnimationFrame(r));
    await new Promise((r) => requestAnimationFrame(r));
    return activeLayer().key;
  });
  expect(key).toBe('solar-system');
});

test('every layer keeps its own unit', async ({ page }) => {
  const units = await page.evaluate(() =>
    window.__universeMap!.layers.map((l) => `${l.def.key}:${l.def.unit}`),
  );
  expect(units).toEqual([
    'solar-system:AU',
    'stellar-neighbourhood:ly',
    'local-universe:Mly',
  ]);
});
```

- [ ] **Step 3: Verify everything**

```
npx vitest run
npm run typecheck
npm run lint
npm run build
npx playwright test
```

All must pass, including the six Phase 1 e2e tests. If `loads the tileset and reports the baked point count` fails, `window.__universeMap.tileset` is no longer resolving to the stellar layer — that getter is what keeps Phase 1's tests meaningful.

- [ ] **Step 4: Look at it**

```bash
npm run dev
```

Fly outward from the start position. Expect the star field to thin, fade, and give way to a sparse field of galaxies; fly back and the stars return. Report what actually happens, including anything that looks wrong — a visible jump at handover, a rotation, a flash of empty sky, or the field vanishing entirely.

- [ ] **Step 5: Commit**

```bash
git add app/src/main.ts e2e/render.spec.ts
git commit -m "feat(app): compose three scale layers with crossfade handover"
```

- [ ] **Step 6: STOP — Phase 2a handoff**

Report to the user: object and tile counts per layer, whether the crossfade looks continuous, and anything in Phase 2b or 2c scope that this work made look wrong. Do not begin Phase 2b.

---

## Plan Self-Review

**Spec coverage.** Section 3.2 (layer ladder) — Tasks 2, 6, covering L0/L1/L3 only; L2 and L4 are 2b/2c by design. Section 5.1 (layer compositing) — Task 7, with one deviation recorded below. Section 3.4 (measured versus modeled) — Task 1 supplies `FLAG_MODELED` and `FLAG_NOMINAL_MAGNITUDE`; no modeled population exists until 2c. Section 6 hover card — Task 1 Step 8 adds the nominal-magnitude wording.

**Deviations from the spec, deliberate:**

1. **Layers are composited in one scene, not in separate depth-cleared passes.** Section 5.1 calls for a pass per layer. Point rendering already runs with depth test and write disabled under additive blending, so cross-layer depth conflict is impossible and a second pass would buy nothing. Revisit when a layer draws something other than points.
2. **L1 and L3 have a gap, not an overlap.** L2 is a later phase, so the transition band spans 5,000 to 300,000 light-years with no data in it. The selection logic treats a gap exactly like an overlap; when L2 lands the same code handles the narrower band unchanged.
3. **`position_ly` holds whatever the layer's unit is.** The name is a Phase 1 artefact. Renaming it touches every source and every test for no behavioural gain.

**Placeholder scan:** none. Every code step carries complete code.

**Type consistency:** `LayerDef` (Task 6) is consumed unchanged by Tasks 7 and 8. `opacityForBlend` has the same signature in Tasks 7 and 8. `build_layer`'s new `names` and `id_prefix` parameters (Task 5) match the CLI call sites. `pack_type` / `object_class` (Task 1) are used by Tasks 3 and 4. The registry in Task 6 Step 4 mirrors `config.py` from Task 2 — if one changes, both must.
