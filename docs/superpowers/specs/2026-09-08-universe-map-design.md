# Universe Map — Design Specification

- **Date:** 2026-09-08
- **Status:** Approved (Section 1); Sections 2–6 written for review
- **Target:** A local-first, browser-based 3D map of the known universe, rendered
  from real astronomical catalogs, navigable continuously from the solar system
  out to the cosmic web.

---

## 1. Goal and success criteria

Build a web application that renders millions of real astronomical objects as a
navigable 3D point field. The user flies outward from Earth through nested scale
layers — solar system, stellar neighborhood, Milky Way, local universe, cosmic
web — with objects positioned from measured catalog data, not hand placement.

**Done means:**

1. The app runs locally and holds 60 fps, with a hard floor of 30 fps during
   active tile streaming, while displaying 10M+ objects as the camera moves.
2. Every rendered object's position derives from a catalog record through a
   documented transform. No object is manually placed.
3. Hovering any object identifies it. Earth and the Milky Way carry permanent
   labels so the viewer always knows where they are.
4. Objects that are modeled rather than measured are visually and textually
   distinguishable from measured ones.
5. A golden test suite places definitional reference directions — the galactic
   pole, the galactic centre, Sagittarius A* — within 1 arcsecond, and reproduces
   parallax-to-distance exactly.

**Explicitly out of scope:** public hosting, CDN delivery, any backend service,
user accounts, and mobile support. This runs from a local dev server against
tiles on local disk.

---

## 2. Architecture

Two independent halves joined by one frozen contract.

```
pipeline/  (Python, offline)              app/  (TypeScript, browser)
  fetch     catalog downloads               core/         renderer, camera, controls
  normalize -> common record schema         tiles/        octree traversal, LOD, streaming
  assign    -> scale layer                  layers/       layer defs, crossfade
  transform -> layer-local Cartesian        render/       point shaders, picking pass
  tile      -> octree of binary tiles       interaction/  hover, labels, search
  index     -> searchable name index        ui/           HUD, filters, time control
                       |                             |
                       +---> public/data/ <----------+
                             (tile format v1)
```

`app/` contains no astronomy knowledge. It renders a tiled point dataset and
would render any other one. `pipeline/` contains no rendering knowledge. Neither
half may reach into the other; the tile format is the only coupling.

### 2.1 Why a custom tile format

The tiling *algorithm* is borrowed from Potree: an additive-refinement octree
where each node holds a random subsample of the points beneath it, and
descending adds detail rather than replacing it. Traversal is driven by
screen-space error. This is mature, well-understood, and correct for our case.

The *file format* is our own. Potree and 3D Tiles are built for lidar and
geospatial point clouds. Our per-point attributes — 3D velocity, absolute
magnitude, color index, catalog identifier, type flags, measured-vs-modeled —
do not map cleanly onto either, and bending an existing format around them costs
more than writing what is, structurally, an octree of typed binary arrays.

---

## 3. Data

### 3.1 Sources

| Source | Provides | Access | Notes |
|---|---|---|---|
| Gaia DR3 | ~1.8B sources; positions, parallax, proper motion, G magnitude, BP−RP color; ~33M with radial velocity | `astroquery.gaia` ADQL, chunked by HEALPix | Full release is ~10 TB; we pull a magnitude-limited subset |
| Gaia DR3 distances (Bailer-Jones et al. 2021) | Geometric and photogeometric distances | Gaia archive external table | Preferred over naive `1/parallax`, which is biased at low signal-to-noise |
| Cosmicflows-4 | 55,877 galaxies with measured distances **and peculiar velocities** | Extragalactic Distance Database (edd.ifa.hawaii.edu) | The only source giving galaxies real motion rather than pure Hubble flow |
| SDSS LSS catalogs | Galaxies and quasars to z ≈ 2.2 | SDSS Science Archive Server | Cosmic web filaments and voids |
| OpenNGC / Messier | Named deep-sky objects: nebulae, clusters, galaxies | Public catalog files | The labelable, recognizable objects |
| Black hole catalogs | Known stellar-mass and supermassive black holes | Literature compilations | Small, curated, high-value |
| JPL planetary elements | Sun, planets, major moons | Static orbital elements | L0 only; tiny |

**Gaia DR4 releases 2 December 2026** with 2.8B sources. The pipeline must be
catalog-version agnostic — source version is configuration, not code.

### 3.2 Layer ladder

Each layer has its own unit and origin. This is what makes the full scale range
possible: no single coordinate space ever has to span 27 orders of magnitude.

| Layer | Range | Unit | Origin | Primary data |
|---|---|---|---|---|
| L0 Solar System | 0 – 0.01 ly | AU | Sun | Keplerian elements |
| L1 Stellar Neighborhood | 0.01 – 5,000 ly | ly | Sun | Gaia DR3 (bulk of the 10M+) |
| L2 Milky Way | 5,000 – 300,000 ly | ly | Galactic Center | Clusters, nebulae, black holes + **modeled** stellar population |
| L3 Local Universe | 0.3 – 300 Mly | Mly | Milky Way | Cosmicflows-4, OpenNGC galaxies |
| L4 Cosmic Web | 300 Mly – 14 Gly | Mly (comoving) | Milky Way | SDSS LSS |

Adjacent layers overlap by roughly half a decade of distance; the crossfade
happens inside the overlap band so neither layer ever pops in against emptiness.

The canonical frame is **Galactic Cartesian**, so the Milky Way disk lies in the
XY plane. This is a presentation choice: it makes the map read as a map.

### 3.3 Coordinate transforms

ICRS spherical to Cartesian, with `d` the distance in the layer's unit:

```
x = d * cos(dec) * cos(ra)
y = d * cos(dec) * sin(ra)
z = d * sin(dec)
```

then rotated ICRS to Galactic by the standard fixed rotation matrix.

Distances come from Bailer-Jones geometric estimates where available, falling
back to `1000 / parallax_mas` parsecs only where `parallax_over_error` exceeds a
configured threshold. Objects failing both are dropped, not guessed.

Space velocity is derived from proper motion and radial velocity. Tangential
velocity in km/s is `4.74047 * mu_mas_per_yr * d_pc / 1000`, decomposed onto the
RA and Dec unit vectors and summed with the radial component, then rotated into
the Galactic frame alongside position.

### 3.4 Measured versus modeled

Between roughly 5,000 and 300,000 light-years, galactic dust blocks Gaia, so
real catalogs give only a few thousand scattered objects — nowhere near a galaxy
shape. L2 therefore includes a procedurally generated stellar population drawn
from an accepted Milky Way structural model (disk, bar, bulge, halo).

Every point carries a `modeled` flag. Modeled points render dimmer, are excluded
from hover picking and search, and the HUD shows a persistent notice while the
modeled population is visible. A filter toggles it off entirely. The map must
never let a viewer mistake invention for measurement.

### 3.5 Object count is configuration

The 10M+ target is reached by tuning a G-magnitude limit in pipeline config, not
by a hardcoded count. Denser or sparser builds are a config change and a rerun.

---

## 4. Tile format v1

Frozen before Phase 1 implementation and documented in `docs/tile-format.md`.

### 4.1 Tileset index — `public/data/<layer>/tileset.json`

Layer metadata (unit, unit-in-meters, reference frame, origin description),
attribute layout, and the octree node tree. Each node records its bounding box,
geometric error, point count, and children.

### 4.2 Tile blob — `public/data/<layer>/<node-path>.bin`

A header (magic, format version, point count, float64 bounding box, attribute
layout) followed by structure-of-arrays attribute blocks:

| Attribute | Type | Notes |
|---|---|---|
| position | 3 x uint16 | Quantized within the tile's own bounding box |
| velocity | 3 x float16 | km/s, Galactic frame |
| colorIndex | uint16 | Index into a shared color lookup table |
| absMag | float16 | Absolute magnitude |
| typeFlags | uint8 | Object class + measured/modeled bit |
| localId | uint32 | Index into the layer's identifier table |

**Per-tile position quantization is the key trick.** uint16 gives 65,536 steps
across whatever the tile spans, so precision scales automatically with tile
size — a leaf tile gets fine precision, a root tile gets coarse precision it
does not need at that zoom. This halves memory versus float32 with no visible
loss, and sidesteps float precision problems structurally.

### 4.3 Hover sidecar

Names, designations and detail text live in a per-tile sidecar fetched only when
the user actually hovers within that tile. Values already resident on the GPU —
distance, magnitude, type — display instantly; the name fills in on arrival.
This keeps 10M names out of the hot path.

---

## 5. Renderer

### 5.1 Layer compositing

Each layer renders in its own pass with its own projection scale and a cleared
depth buffer, composited far to near. Cross-layer depth conflicts become
structurally impossible rather than something to tune. A logarithmic depth
buffer handles range within a layer.

### 5.2 Point rendering

Points are drawn with `gl.POINTS` from per-tile buffers under additive blending
with depth write disabled — stars are point light sources, and additive
compositing is what makes a star field read correctly.

Apparent magnitude is computed in the vertex shader as
`m = absMag + 5 * log10(d_pc) - 5`, brightness as `10^(-0.4 * m)`, with point
size proportional to the square root of brightness and clamped to a sane range.
Brightness also drives alpha. The result is a physically motivated field where
bright and near objects genuinely dominate.

A bloom post-pass follows. This is not decoration: without it a star field looks
like scattered dots rather than stars.

### 5.3 Level of detail and streaming

Screen-space error per node is
`geometricError * screenHeight / (2 * distance * tan(fov / 2))`. Above threshold
the traversal descends; otherwise the node's own subsample is drawn. Refinement
is additive — a parent stays drawn while its children add detail on top.

Loading is a priority queue ordered by screen-space error, capped at 8 in-flight
requests, backed by an LRU cache under a 512 MB GPU byte budget. Both figures are
configuration, tuned once real data exists.

### 5.4 Picking

Object IDs render to an off-screen buffer; the pixel under the cursor is read
back. The pass is throttled to pointer movement and scissored to a small region
around the cursor, so cost is independent of total object count. A small search
radius gives sub-pixel points a usable hit area.

### 5.5 Time playback

Position becomes `p0 + v * t` in the vertex shader — effectively free, since
velocity is already a resident attribute. Default state is t = 0, present day.

Linear extrapolation is honest for roughly a million years for stars; beyond
that, galactic orbits curve and the model breaks. The UI must bound the slider
accordingly. Deep-future extrapolation (Phase 5) needs orbit integration in a
galactic potential and is deliberately deferred.

---

## 6. Interaction

- **Hover card** — identity, distance, type, magnitude, velocity. All objects.
- **Permanent anchors** — Earth and the Milky Way, always labeled. Required.
- **Auto-labels** — notable objects labeled when large or near enough to matter,
  with collision-based decluttering so the view never becomes a wall of text.
- **Search and fly-to** — type a name, camera animates there, crossing scale
  layers automatically. Backed by a name index built alongside the tiles.
- **Scale HUD** — distance from Earth, active layer, logarithmic scale bar.
  Without it, large zoom levels are genuinely unreadable.
- **Filters and legend** — toggle object classes; explain what colors mean; make
  the measured/modeled distinction switchable and obvious.

---

## 7. Verification

Per project discipline, every change passes an independent check. The
project-level oracles:

1. **Golden transform tests (pipeline).** Coordinate errors are the likeliest
   serious bug in this project and are invisible by inspection — a wrong
   rotation produces a starfield that looks perfectly plausible and is entirely
   wrong. Two rules follow.

   **astropy performs the transform.** Hand-rolling the ICRS to Galactic
   rotation is exactly the code that produces plausible-but-wrong output. The
   tests verify our *usage* — right frame, right units, right axis order.

   **Assertions use exactly-defined quantities, not published star distances.**
   Literature distances for individual stars disagree at the percent level, so
   a test hardcoding "Sirius is 8.709 ly" encodes a debate rather than a fact.
   The suite instead asserts that the north galactic pole maps to latitude +90,
   that the galactic centre maps to the origin and onto the +X axis, that
   Sagittarius A* lands at l = 359.944, b = -0.046, that parallax inversion is
   exact, and that tangential speed matches the standard 4.74047 relation.
   Named-object distances are checked for self-consistency against the source
   catalog, never against a hardcoded literature value.
2. **Tiler invariants (property tests).** Every input point lands in exactly one
   leaf; every node's bounding box contains its points; total point count is
   preserved; a parent's subsample is a subset of its descendants.
3. **Format round-trip (cross-language contract test).** Python writes tiles,
   the TypeScript reader reads them, values match within quantization error.
   This guards the frozen interface and is the test that keeps the two halves
   independent.
4. **Renderer end-to-end.** A small fixture dataset, checked into the repo, runs
   the whole pipeline through to render; known objects must land at known screen
   pixels for a fixed camera, with screenshot regression.
5. **Performance gate.** The fixture at scale, asserting frame time and draw
   call count stay within budget.

---

## 8. Build phases

Velocity enters the tile format in Phase 1 despite being unused until Phase 4 —
retrofitting a field into a baked format means regenerating every tile.

| Phase | Content | Demoable |
|---|---|---|
| 1 | Tile format v1 frozen; pipeline for L1 only (Gaia); renderer with streaming, LOD, free-fly camera, hover picking, Earth anchor | **Yes** — fly through the real stellar neighborhood |
| 2 | Remaining four layers; crossfade state machine; modeled Milky Way population; scale to 10M+ | **Yes** — full zoom-out, Earth to cosmic web |
| 3 | Auto-labels with decluttering; search and fly-to; scale HUD; filters and legend | **Yes** — the map becomes readable and explorable |
| 4 | Time playback | **Yes** — watch the sky drift |
| 5 *(deferred)* | Deep-future extrapolation with galactic potential integration | **Yes** |

**Phase handoff rule:** at the end of every phase that produces something
runnable, stop and hand off. Do not begin the next phase without direction.

---

## 9. Risks

| Risk | Mitigation |
|---|---|
| Coordinate transform bugs — wrong but plausible-looking positions | Known-object golden tests are written before the transform code |
| Tiling pipeline consumes the schedule | It is Phase 1 and nothing else is built until it works end to end on one layer |
| Gaia bulk extraction is slow or rate-limited | Chunk by HEALPix, cache raw downloads on disk, never refetch |
| Fill-rate collapse from additive blending over many overlapping points | Point size clamped; performance gate in CI from Phase 1 |
| Modeled L2 population misread as real | Distinct rendering, excluded from picking and search, persistent notice, filter toggle |
