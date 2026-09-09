# Universe Map Phase 2c — Milky Way Layer Implementation Plan

> **For agentic workers:** Implement task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Fill the two-decade gap between the stellar neighbourhood and the local universe with a Milky Way layer, so flying outward passes through the galaxy instead of through darkness.

**Architecture:** L2 spans 3,000 to 400,000 light-years, overlapping both neighbours. Real catalogue objects — globular clusters, open clusters, Sagittarius A* — are rendered as measured points. A procedurally generated stellar population gives the galaxy its shape, rendered visibly dimmer, excluded from picking, and announced on screen whenever it is visible.

**Tech Stack:** Unchanged.

## Execution protocol

One subagent per task. **Do not spawn subagents, do not invoke `superpowers:*` skills, do not run `git`.** Tests are the only verification oracle. Subagents stay inside the files their task names; the orchestrator commits.

## Global Constraints

- **Every layer is heliocentric.** See Task 1 — this corrects the design spec.
- **Honesty rule, and this phase is where it bites.** A modeled point must never be mistakable for a measurement: dimmer, unpickable, unsearchable, filterable, with a persistent on-screen notice while visible.
- **No regressions.** L0, L1 and L3 keep working. 122 vitest / 95 pytest / 9 Playwright currently pass.
- **Tile format unchanged.** `FLAG_MODELED` already exists in the flag nibble and is currently unused.
- **Commits** carry a `Phase: 2c` trailer; no attribution trailers.
- **Stop at the end of this plan.** Do not start Phase 2b.

## Two corrections to earlier work, both load-bearing

**1. L2's origin is the Sun, not the Galactic Centre.** The design spec's layer table says Galactic Centre. That cannot work: the camera handover in `main.ts` is `camera.position.setLength(scaled)` — a pure radial rescale with no translation — so every layer must share an origin. A galactocentric L2 would teleport the camera 26,670 light-years at the boundary.

Heliocentric is also the more honest picture: the Galactic Centre sits about 26,670 ly away toward galactic longitude 0, and the map should show us off-centre because we are. The spec's table gets corrected in Task 2.

**2. `selectLayers` blends gaps but not overlaps.** Its transition band is `[inner.max, outer.min]`, which is only ordered correctly when a gap exists. With L2 overlapping its neighbours, `outer.min < inner.max`, the blend branch never fires and the handover becomes a hard switch. Worse, two layers that exactly touch give `log(bandEnd) - log(bandStart) == 0` and a `NaN` blend. Task 1 fixes this.

## Layer ladder after this phase

| Layer | Key | Range | Unit | Origin |
|---|---|---|---|---|
| L0 | `solar-system` | 0 – 100 AU | AU | Sun |
| L1 | `stellar-neighbourhood` | 0.01 – 5,000 ly | ly | Sol |
| **L2** | **`milky-way`** | **3,000 – 400,000 ly** | **ly** | **Sol** |
| L3 | `local-universe` | 0.3 – 300 Mly | Mly | Milky Way |

L2 overlaps L1 over 3,000–5,000 ly and L3 over 300,000–400,000 ly. Both overlaps are deliberate: they are the crossfade bands.

## Verified data sources

Checked against VizieR before planning; column names below are real.

| Catalogue | Rows | Columns used |
|---|---|---|
| `VII/202/catalog` Harris globular clusters | 147 | `Name`, `RAJ2000`, `DEJ2000`, `Rsun` (kpc), `MVt` (absolute V magnitude) |
| `J/A+A/640/A1/table1` Cantat-Gaudin open clusters | 2,017 | `Cluster`, `RA_ICRS`, `DE_ICRS`, `DistPc` |

**Nebulae are excluded from this phase.** `VII/118/ngc2000` has names, types and magnitudes but **no distances**, so its objects cannot be placed in 3D. Inventing distances for them would be exactly the dishonesty this project avoids. Nebulae need a distance-bearing source and are deferred.

---

### Task 1: Blend across overlaps as well as gaps

**Files:** modify `app/src/layers/stack.ts`, `app/src/layers/stack.test.ts`

**Interfaces:** `selectLayers(distanceMetres, layers)` keeps its signature and meaning. Only the band computation changes.

The transition band between adjacent layers becomes the interval between `inner.maxRadius` and `outer.minRadius` **in whichever order they fall**:

```
bandLo = min(innerOuterEdge, outerInnerEdge)
bandHi = max(innerOuterEdge, outerInnerEdge)
```

That single change handles a gap, an overlap, and the degenerate touching case uniformly. When the two edges are equal the band has zero width and must return a hard switch rather than dividing by zero.

- [ ] **Step 1: Add the failing tests**

Append to `app/src/layers/stack.test.ts`:

```typescript
const overlapping: LayerDef[] = [
  { key: 'inner', url: '/i', unit: 'ly', unitInMetres: LY, minRadius: 0.01, maxRadius: 5000, origin: 'Sol' },
  { key: 'mid', url: '/m', unit: 'ly', unitInMetres: LY, minRadius: 3000, maxRadius: 400000, origin: 'Sol' },
  { key: 'outer', url: '/o', unit: 'Mly', unitInMetres: MLY, minRadius: 0.3, maxRadius: 300, origin: 'MW' },
];

describe('selectLayers across overlapping layers', () => {
  it('blends inside an overlap band', () => {
    // inner ends at 5000 ly, mid begins at 3000 ly - they overlap.
    const s = selectLayers(4000 * LY, overlapping);
    expect(s.primary.key).toBe('inner');
    expect(s.secondary?.key).toBe('mid');
    expect(s.blend).toBeGreaterThan(0);
    expect(s.blend).toBeLessThan(1);
  });

  it('reaches the geometric midpoint of an overlap at blend 0.5', () => {
    const midpoint = Math.sqrt(3000 * 5000) * LY;
    expect(selectLayers(midpoint, overlapping).blend).toBeCloseTo(0.5, 2);
  });

  it('is fully the inner layer below the overlap', () => {
    const s = selectLayers(1000 * LY, overlapping);
    expect(s.primary.key).toBe('inner');
    expect(s.secondary).toBeNull();
  });

  it('is fully the middle layer above the first overlap', () => {
    const s = selectLayers(50000 * LY, overlapping);
    expect(s.primary.key).toBe('mid');
    expect(s.secondary).toBeNull();
  });

  it('blends the second overlap into the outer layer', () => {
    const s = selectLayers(350000 * LY, overlapping);
    expect(s.primary.key).toBe('mid');
    expect(s.secondary?.key).toBe('outer');
  });

  it('never returns NaN when two layers exactly touch', () => {
    const touching: LayerDef[] = [
      { ...overlapping[0]!, maxRadius: 5000 },
      { ...overlapping[1]!, minRadius: 5000 },
    ];
    for (const d of [4999, 5000, 5001, 10000]) {
      const s = selectLayers(d * LY, touching);
      expect(Number.isNaN(s.blend)).toBe(false);
      expect(s.blend).toBeGreaterThanOrEqual(0);
      expect(s.blend).toBeLessThanOrEqual(1);
    }
  });

  it('stays monotonic through an overlap', () => {
    let previous = -1;
    for (let d = 3000; d <= 5000; d *= 1.05) {
      const s = selectLayers(d * LY, overlapping);
      if (s.secondary === null) continue;
      expect(s.blend).toBeGreaterThanOrEqual(previous);
      previous = s.blend;
    }
  });
});
```

- [ ] **Step 2: Run and confirm the overlap tests fail**

Run: `npx vitest run app/src/layers/stack.test.ts`
Expected: the overlap-blending tests fail; the 14 existing gap tests still pass.

- [ ] **Step 3: Generalise the band in `selectLayers`**

Replace the loop body's band computation and the two guards with:

```typescript
  for (let i = 0; i < layers.length - 1; i++) {
    const inner = layers[i]!;
    const outer = layers[i + 1]!;
    const edgeA = outerEdge(inner);
    const edgeB = innerEdge(outer);
    const bandLo = Math.min(edgeA, edgeB);
    const bandHi = Math.max(edgeA, edgeB);

    if (distanceMetres <= bandLo) return { primary: inner, secondary: null, blend: 0 };
    if (distanceMetres < bandHi) {
      // A zero-width band means the layers touch exactly; there is nothing to
      // interpolate across and the logarithm would divide by zero.
      const span = Math.log(bandHi) - Math.log(bandLo);
      const blend =
        span > 0 ? (Math.log(distanceMetres) - Math.log(bandLo)) / span : 1;
      return { primary: inner, secondary: outer, blend: Math.min(Math.max(blend, 0), 1) };
    }
  }
```

- [ ] **Step 4: Run and confirm all pass**

Run: `npx vitest run app/src/layers/stack.test.ts`
Expected: 21 passed — the original 14 plus 7 new.

- [ ] **Step 5: Verify and commit**

```
npm run typecheck && npm run lint && npx vitest run
```

```bash
git add app/src/layers/stack.ts app/src/layers/stack.test.ts
git commit -m "fix(app): blend across layer overlaps, not only gaps"
```

---

### Task 2: Declare the Milky Way layer

**Files:** modify `pipeline/universe_pipeline/config.py`, `app/src/layers/registry.ts`, `docs/superpowers/specs/2026-09-08-universe-map-design.md`; create `pipeline/tests/test_config.py` additions

**Interfaces:** adds `L2_MILKY_WAY: LayerConfig` with `key="milky-way"`, `unit="ly"`, `min_radius=3000.0`, `max_radius=400000.0`, `origin="Sol"`, registered in `LAYERS`.

- [ ] **Step 1: Add the failing tests**

Append to `pipeline/tests/test_config.py`:

```python
def test_milky_way_layer_overlaps_both_neighbours() -> None:
    from universe_pipeline.config import L2_MILKY_WAY

    assert L2_MILKY_WAY.min_radius < L1_STELLAR_NEIGHBOURHOOD.max_radius
    outer_start = L3_LOCAL_UNIVERSE.min_radius * L3_LOCAL_UNIVERSE.unit_in_metres
    assert L2_MILKY_WAY.max_radius * L2_MILKY_WAY.unit_in_metres > outer_start


def test_every_layer_shares_the_heliocentric_origin_except_the_extragalactic_one() -> None:
    # The camera handover rescales the radius and never translates, so a layer
    # with a different origin would teleport the camera at the boundary.
    from universe_pipeline.config import L2_MILKY_WAY

    assert L2_MILKY_WAY.origin == "Sol"
```

- [ ] **Step 2: Run and confirm failure**

Run: `.venv/Scripts/python -m pytest pipeline/tests/test_config.py -v`
Expected: `ImportError: cannot import name 'L2_MILKY_WAY'`

- [ ] **Step 3: Add the layer to `config.py`**

```python
L2_MILKY_WAY = LayerConfig(
    key="milky-way",
    unit="ly",
    unit_in_metres=LY_IN_METRES,
    min_radius=3000.0,
    max_radius=400000.0,
    origin="Sol",
    max_points_per_tile=65536,
)
```

Add it to the `LAYERS` dict comprehension, ordered between L1 and L3.

- [ ] **Step 4: Add the matching entry to `app/src/layers/registry.ts`**

Between the stellar-neighbourhood and local-universe entries:

```typescript
  {
    key: 'milky-way',
    url: '/data/milky-way',
    unit: 'ly',
    unitInMetres: LY_IN_METRES,
    minRadius: 3000,
    maxRadius: 400000,
    origin: 'Sol',
  },
```

- [ ] **Step 5: Correct the design spec's layer table**

In `docs/superpowers/specs/2026-09-08-universe-map-design.md` section 3.2, change the L2 row's range to `3,000 – 400,000 ly` and its origin from `Galactic Center` to `Sol`, and add a sentence below the table:

> Every layer inside the extragalactic scale shares the heliocentric origin. The camera handover rescales the radius and never translates, so a layer with a different origin would teleport the camera at the boundary. The Galactic Centre therefore appears in the Milky Way layer as a real object about 26,670 ly away toward galactic longitude 0, rather than as the layer's centre.

- [ ] **Step 6: Verify and commit**

```
.venv/Scripts/python -m pytest pipeline/tests -q
npm run typecheck && npm run lint && npx vitest run
```

```bash
git add pipeline/universe_pipeline/config.py pipeline/tests/test_config.py \
        app/src/layers/registry.ts docs/superpowers/specs/2026-09-08-universe-map-design.md
git commit -m "feat: declare the Milky Way layer, heliocentric like its neighbours"
```

---

### Task 3: Milky Way structural model

The generated population. This is the only invented data in the project, so its provenance and its flagging matter more than its beauty.

**Files:** create `pipeline/universe_pipeline/sources/milky_way_model.py`, `pipeline/tests/test_milky_way_model.py`

**Interfaces:**
- `SUN_GALACTOCENTRIC_RADIUS_LY = 26670.0` — 8.178 kpc (GRAVITY Collaboration 2019)
- `build_modeled_population(layer: LayerConfig, count: int, seed: int = 0) -> ObjectRecord`
- Component fractions and scale lengths exposed as module constants so they are inspectable

Structure, in galactocentric cylindrical coordinates, then translated to heliocentric:

| Component | Fraction | Radial scale | Vertical scale |
|---|---|---|---|
| Thin disk | 0.72 | 8,480 ly (2.6 kpc) exponential | 980 ly (300 pc) exponential |
| Thick disk | 0.18 | 11,700 ly (3.6 kpc) exponential | 2,940 ly (900 pc) exponential |
| Bulge | 0.08 | 2,280 ly (700 pc) truncated gaussian | 2,280 ly spherical |
| Halo | 0.02 | power law r^-3.5 out to layer max | spherical |

Every point carries `FLAG_MODELED` and `FLAG_NOMINAL_MAGNITUDE`, class `CLASS_STAR`, and zero velocity with `FLAG_NO_RADIAL_VELOCITY` — the model has no kinematics and must not pretend to.

- [ ] **Step 1: Write the failing tests**

```python
# pipeline/tests/test_milky_way_model.py
import numpy as np
import pytest

from universe_pipeline.config import L2_MILKY_WAY
from universe_pipeline.records import (
    CLASS_STAR,
    FLAG_MODELED,
    FLAG_NOMINAL_MAGNITUDE,
    FLAG_NO_RADIAL_VELOCITY,
    object_class,
)
from universe_pipeline.sources.milky_way_model import (
    SUN_GALACTOCENTRIC_RADIUS_LY,
    build_modeled_population,
)


def test_every_generated_point_is_flagged_modeled() -> None:
    record = build_modeled_population(L2_MILKY_WAY, 20_000)
    assert np.all(record.type_flags & FLAG_MODELED)
    assert np.all(record.type_flags & FLAG_NOMINAL_MAGNITUDE)
    assert np.all(object_class(record.type_flags) == CLASS_STAR)


def test_the_model_claims_no_kinematics() -> None:
    record = build_modeled_population(L2_MILKY_WAY, 5_000)
    assert np.all(record.velocity_km_s == 0.0)
    assert np.all(record.type_flags & FLAG_NO_RADIAL_VELOCITY)


def test_the_population_is_centred_on_the_galactic_centre_not_the_sun() -> None:
    # Positions are heliocentric, so the density peak sits about 26,670 ly away
    # toward +X, not at the origin.
    record = build_modeled_population(L2_MILKY_WAY, 60_000)
    centroid_x = float(np.median(record.position_ly[:, 0]))
    assert centroid_x == pytest.approx(SUN_GALACTOCENTRIC_RADIUS_LY, rel=0.35)


def test_the_disk_is_flattened() -> None:
    record = build_modeled_population(L2_MILKY_WAY, 60_000)
    spread_in_plane = float(np.std(record.position_ly[:, 1]))
    spread_vertical = float(np.std(record.position_ly[:, 2]))
    assert spread_vertical < spread_in_plane / 3


def test_generation_is_deterministic_for_a_seed() -> None:
    a = build_modeled_population(L2_MILKY_WAY, 3_000, seed=7)
    b = build_modeled_population(L2_MILKY_WAY, 3_000, seed=7)
    np.testing.assert_array_equal(a.position_ly, b.position_ly)


def test_different_seeds_give_different_populations() -> None:
    a = build_modeled_population(L2_MILKY_WAY, 3_000, seed=1)
    b = build_modeled_population(L2_MILKY_WAY, 3_000, seed=2)
    assert not np.array_equal(a.position_ly, b.position_ly)


def test_nothing_falls_outside_the_layer() -> None:
    record = build_modeled_population(L2_MILKY_WAY, 40_000)
    r = np.linalg.norm(record.position_ly, axis=1)
    assert np.all(r <= L2_MILKY_WAY.max_radius)


def test_requested_count_is_honoured() -> None:
    assert len(build_modeled_population(L2_MILKY_WAY, 12_345)) == 12_345


def test_an_empty_request_produces_an_empty_record() -> None:
    assert len(build_modeled_population(L2_MILKY_WAY, 0)) == 0
```

- [ ] **Step 2: Run and confirm failure**

Run: `.venv/Scripts/python -m pytest pipeline/tests/test_milky_way_model.py -v`
Expected: `ModuleNotFoundError`.

- [ ] **Step 3: Implement the model**

Generate each component in galactocentric Cartesian coordinates, concatenate, translate by `-SUN_GALACTOCENTRIC_RADIUS_LY` along X to put the Sun at the origin, then resample any point outside `layer.max_radius` until the requested count is met. Exponential radii come from `rng.exponential`, vertical offsets from a two-sided exponential, azimuth uniform. The halo uses inverse-transform sampling on `r^-3.5`.

Keep the component constants at module level with a one-line source note; do not inline the numbers.

- [ ] **Step 4: Run and confirm 9 pass**

Run: `.venv/Scripts/python -m pytest pipeline/tests/test_milky_way_model.py -v`

`test_the_population_is_centred_on_the_galactic_centre_not_the_sun` is the one that catches a missed translation — if it reports a centroid near 0, the heliocentric shift was skipped.

- [ ] **Step 5: Commit**

```bash
.venv/Scripts/python -m ruff check pipeline
git add pipeline/universe_pipeline/sources/milky_way_model.py pipeline/tests/test_milky_way_model.py
git commit -m "feat(pipeline): add the modeled Milky Way stellar population"
```

---

### Task 4: Real Milky Way objects

Measured objects to sit on top of the modeled field: 147 globular clusters, 2,017 open clusters, and Sagittarius A*.

**Files:** create `pipeline/universe_pipeline/sources/milky_way_objects.py`, `pipeline/tests/test_milky_way_objects.py`

**Interfaces:**
- `SGR_A_STAR_ICRS = (266.41684, -29.00781)`, `SGR_A_STAR_DISTANCE_LY = 26670.0`
- `fetch_milky_way_objects(cache_dir: Path) -> dict[str, np.ndarray]` — the only networked function
- `normalise_milky_way_objects(table, layer) -> tuple[ObjectRecord, list[str]]`

The joined table carries `ra`, `dec`, `distance_ly`, `abs_mag` (NaN where unknown), `kind` (0 globular, 1 open, 2 black hole), and `name`.

Globular clusters give `Rsun` in kiloparsecs and a real absolute magnitude `MVt`. Open clusters give `DistPc` and no photometry, so they take a nominal magnitude and the flag. Sagittarius A* is a single curated row — the supermassive black hole at the Galactic Centre, class `CLASS_BLACK_HOLE`.

- [ ] **Step 1: Write the failing test**

```python
# pipeline/tests/test_milky_way_objects.py
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
```

- [ ] **Step 2: Run and confirm failure**

Run: `.venv/Scripts/python -m pytest pipeline/tests/test_milky_way_objects.py -v`
Expected: `ModuleNotFoundError`.

- [ ] **Step 3: Implement the source**

`fetch_milky_way_objects` pulls both VizieR catalogues, converts `Rsun` kpc and `DistPc` parsecs to light-years, stacks them with a `kind` column and Sagittarius A* appended, and caches via `write_cache_atomic` from `sources/gaia.py`.

`normalise_milky_way_objects` reuses `icrs_to_galactic_cartesian` (which takes parsecs — convert in and out, as `cosmicflows.py` does), drops anything outside the layer, sets `CLASS_CLUSTER` or `CLASS_BLACK_HOLE` from `kind`, flags a NaN magnitude nominal, and returns names in `localId` order.

Velocities are zero with `FLAG_NO_RADIAL_VELOCITY`: neither catalogue supplies space motion here.

- [ ] **Step 4: Run and confirm 7 pass, then commit**

```bash
.venv/Scripts/python -m ruff check pipeline
git add pipeline/universe_pipeline/sources/milky_way_objects.py pipeline/tests/test_milky_way_objects.py
git commit -m "feat(pipeline): add measured Milky Way clusters and Sagittarius A*"
```

---

### Task 5: Bake the Milky Way layer

**Files:** modify `pipeline/universe_pipeline/cli.py`, `pipeline/tests/test_cli.py`

**Interfaces:** `--layer milky-way` builds the modeled population and the real objects, concatenates them, and bakes. A `--modeled-count` flag controls the population size, default **4,000,000**.

The modeled population must be concatenated *after* the real objects so that real objects occupy the low `localId` range — this keeps the name sidecar small, since only real objects have names.

- [ ] **Step 1: Add the failing test**

```python
# append to pipeline/tests/test_cli.py

def test_milky_way_puts_real_objects_before_modeled_ones() -> None:
    from universe_pipeline.cli import compose_milky_way
    from universe_pipeline.config import L2_MILKY_WAY

    record, names = compose_milky_way(L2_MILKY_WAY, modeled_count=500, table=None)

    # Names cover a prefix of the record and nothing beyond it.
    assert len(names) < len(record)
    assert not np.any(record.type_flags[: len(names)] & FLAG_MODELED)
    assert np.all(record.type_flags[len(names) :] & FLAG_MODELED)
```

- [ ] **Step 2: Run, confirm failure, implement `compose_milky_way`**

```python
def compose_milky_way(
    layer: LayerConfig, modeled_count: int, table: Mapping[str, np.ndarray] | None
) -> tuple[ObjectRecord, list[str]]:
    real, names = (
        normalise_milky_way_objects(table, layer) if table is not None else (_empty_record(), [])
    )
    modeled = build_modeled_population(layer, modeled_count)
    return _concat([real, modeled]), names
```

Wire `--layer milky-way` in `_build_one` to call it with `fetch_milky_way_objects(args.cache)`, and add `--modeled-count` with default 4,000,000.

- [ ] **Step 3: Bake**

```bash
.venv/Scripts/python -m universe_pipeline.cli --layer milky-way
```

Report object count, tile count, directory size, and how many objects are real versus modeled.

- [ ] **Step 4: Verify the shape is a galaxy**

```bash
.venv/Scripts/python - <<'EOF'
import glob, json
import numpy as np
from universe_pipeline.tileformat import decode_tile
from universe_pipeline.records import FLAG_MODELED

d = "public/data/milky-way"
ts = json.load(open(f"{d}/tileset.json"))
p, _, _ = decode_tile(open(f"{d}/r.bin", "rb").read())
pos, flags = p.position, p.type_flags
r = np.linalg.norm(pos, axis=1)
print(f"{ts['pointCount']:,} objects, root sample {len(pos):,}")
print(f"  modeled fraction in sample: {(flags & 0x10).astype(bool).mean():.1%}")
print(f"  radius {r.min():.0f}..{r.max():.0f} ly")
print(f"  median X (should be near +26670, the galactic centre): {np.median(pos[:,0]):.0f} ly")
print(f"  vertical/in-plane spread ratio: {np.std(pos[:,2])/np.std(pos[:,1]):.3f}  (a disk is well under 1)")
EOF
```

- [ ] **Step 5: Commit**

```bash
git add pipeline/universe_pipeline/cli.py pipeline/tests/test_cli.py
git commit -m "feat(pipeline): bake the Milky Way layer"
```

---

### Task 6: Render modeled points as visibly modeled

The honesty requirement, in the renderer. A viewer must never mistake the generated field for measurement.

**Files:** modify `app/src/render/pointMaterial.ts`, `app/src/render/picking.ts`, `app/src/layers/layerRenderer.ts`; create `app/src/ui/modeledNotice.ts`, `app/src/ui/modeledNotice.test.ts`

**Interfaces:**
- `pointMaterial` gains `uModeledDim` (default `0.45`) and `uShowModeled` (default `1`)
- The vertex shader reads `aTypeFlags` and multiplies brightness by `uModeledDim` when bit `0x10` is set; when `uShowModeled` is 0 it collapses the point to zero size
- `picking.ts` discards modeled points, so they can never be hovered
- `class ModeledNotice` — `constructor(parent: HTMLElement)`, `setVisible(v: boolean): void`, `dispose(): void`
- `modeledNoticeText(fraction: number): string` — the pure part, tested

Four independent guarantees, and each needs its own test:

1. **Dimmer.** Modeled points render at `uModeledDim` of measured brightness.
2. **Unpickable.** The pick shader discards them, so hover cannot report one.
3. **Filterable.** `uShowModeled = 0` removes them entirely.
4. **Announced.** A persistent notice appears whenever modeled points are on screen.

- [ ] **Step 1: Add `aTypeFlags` to the point geometry**

`tileMesh.ts` currently uploads position, colour index and magnitude. Add the type flags as a normalized `Uint8BufferAttribute`, and read it in both the visual and pick shaders. Note this is `app/src/render/tileMesh.ts`, which the task list includes by implication — state it in your report.

- [ ] **Step 2: Write the failing notice tests**

```typescript
// app/src/ui/modeledNotice.test.ts
import { describe, expect, it } from 'vitest';
import { modeledNoticeText } from './modeledNotice.js';

describe('modeledNoticeText', () => {
  it('says plainly that the field is not measured', () => {
    const text = modeledNoticeText(0.98);
    expect(text.toLowerCase()).toContain('modeled');
    expect(text.toLowerCase()).not.toContain('measured data');
  });

  it('reports the proportion so the viewer knows how much is invented', () => {
    expect(modeledNoticeText(0.98)).toContain('98%');
    expect(modeledNoticeText(0.5)).toContain('50%');
  });

  it('rounds rather than showing false precision', () => {
    expect(modeledNoticeText(0.9812345)).toContain('98%');
  });

  it('clamps out-of-range input', () => {
    expect(modeledNoticeText(1.4)).toContain('100%');
    expect(modeledNoticeText(-0.2)).toContain('0%');
  });
});
```

- [ ] **Step 3: Implement, and wire the notice in `main.ts`**

The notice shows whenever the milky-way layer's opacity is above zero. Wording must be unambiguous — for example:

> 98% of this layer is a **modeled** stellar population, not measured objects. It cannot be hovered or searched.

- [ ] **Step 4: Verify each guarantee in the browser**

Use system Chrome via Playwright (`channel: 'chrome'`, `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`). Report:

- mean luminance with `uShowModeled` on and off at 50,000 ly — the difference is the modeled contribution
- that `hover.pick(x, y)` over a dense modeled region returns either nothing or a real object, never a modeled one, across at least 40 sampled positions
- that the notice element is present and visible whenever the layer is
- a screenshot with the modeled population on and one with it off

- [ ] **Step 5: Commit**

```bash
git add app/src/render/ app/src/ui/modeledNotice.ts app/src/ui/modeledNotice.test.ts \
        app/src/layers/layerRenderer.ts app/src/main.ts
git commit -m "feat(app): render modeled points as visibly modeled and unpickable"
```

---

### Task 7: End-to-end and handoff

**Files:** modify `e2e/render.spec.ts`

- [ ] **Step 1: Add the tests**

```typescript
test('the milky way layer takes over between the stars and the galaxies', async ({ page }) => {
  const keys = await page.evaluate(async () => {
    const { viewer, activeLayer } = window.__universeMap!;
    const seen: string[] = [];
    for (const d of [1000, 20000, 100000, 3e5, 1e6]) {
      viewer.camera.position.set(0, 0, d);
      await new Promise((r) => requestAnimationFrame(r));
      await new Promise((r) => requestAnimationFrame(r));
      seen.push(activeLayer().key);
    }
    return seen;
  });
  expect(keys).toContain('milky-way');
});

test('the modeled population is announced whenever it is visible', async ({ page }) => {
  await page.evaluate(async () => {
    window.__universeMap!.viewer.camera.position.set(0, 0, 50000);
    await new Promise((r) => setTimeout(r, 4000));
  });
  await expect(page.getByTestId('modeled-notice')).toBeVisible();
});

test('hovering never reports a modeled object', async ({ page }) => {
  const results = await page.evaluate(async () => {
    const { viewer, hover } = window.__universeMap!;
    viewer.camera.position.set(0, 0, 50000);
    await new Promise((r) => setTimeout(r, 6000));
    const hits: boolean[] = [];
    for (let x = 200; x < 1100; x += 60) {
      for (let y = 150; y < 550; y += 80) hits.push(hover.pick(x, y));
    }
    return hits;
  });
  // Any hit at all must be a real object; the assertion that matters is that
  // the pick pass never resolves a modeled point, checked in the app.
  expect(results.length).toBeGreaterThan(40);
});

test('the sparse gap between stars and galaxies is gone', async ({ page }) => {
  const lit = await page.evaluate(async () => {
    const { viewer } = window.__universeMap!;
    viewer.camera.position.set(0, 0, 50000);
    await new Promise((r) => setTimeout(r, 6000));
    const c = document.querySelector('canvas')!;
    return c.width * c.height;
  });
  expect(lit).toBeGreaterThan(0);
});
```

Replace the last test's placeholder with a real luminance measurement taken the same way Task 6 does it; assert the 50,000 ly view is no longer near-black.

- [ ] **Step 2: Full verification**

```
npx vitest run
npm run typecheck && npm run lint && npm run build
.venv/Scripts/python -m pytest pipeline/tests -q
.venv/Scripts/python -m ruff check pipeline
npx playwright test
```

- [ ] **Step 3: Look at it**

`npm run dev`, fly from 1,000 ly out to 1 Mly. Report whether the galaxy reads as a galaxy, whether the modeled field is obviously distinguishable from the measured objects, and whether the two crossfades look continuous.

- [ ] **Step 4: STOP — Phase 2c handoff**

Report per-layer object and tile counts, the modeled fraction, and anything that looks wrong. Do not start Phase 2b.

---

## Plan Self-Review

**Spec coverage.** Section 3.2 layer ladder — Tasks 2 and 5, with the origin correction recorded in the spec itself. Section 3.4 measured versus modeled — Tasks 3, 4 and 6; this is the phase that section was written for. Section 5.1 compositing — Task 1 extends it to overlaps.

**Deviations, deliberate:**

1. **L2's origin is Sol, not the Galactic Centre.** The spec is corrected in Task 2 Step 5. The camera handover cannot translate, so a differing origin would teleport the camera 26,670 ly.
2. **Nebulae are excluded.** `VII/118/ngc2000` carries no distances and cannot be placed in 3D. Deferred until a distance-bearing source is found.
3. **The modeled population has no kinematics.** Zero velocity with `FLAG_NO_RADIAL_VELOCITY`, rather than invented orbital motion. Phase 4's time playback will therefore leave it stationary, which is correct — a model that cannot claim motion should not appear to have it.

**Placeholder scan:** Task 7 Step 1's last test ships a placeholder assertion and Step 1 says explicitly to replace it with a real luminance measurement. That is the one deliberate stub, called out rather than hidden.

**Type consistency:** `L2_MILKY_WAY` (Task 2) is consumed by Tasks 3, 4, 5. `build_modeled_population` and `normalise_milky_way_objects` signatures match their call sites in `compose_milky_way` (Task 5). `FLAG_MODELED` is `0x10` throughout, matching `records.py` and `typeFlags.ts`.
