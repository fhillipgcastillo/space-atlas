# Cosmic Web and Navigation Implementation Plan

**Goal:** Complete the layer ladder with the cosmic web, and make 36.7M objects navigable — search, labels, scale readout, and render-distance controls.

**Architecture:** L4 follows the established source→normalise→bake pattern exactly. The navigation features are independent modules over the existing `window.__universeMap` surface, each with pure logic that unit-tests and a thin DOM shell.

## Execution protocol

One subagent per task, several in parallel on disjoint files. **No subagents, no `superpowers:*` skills, no `git`.** Tests are the oracle. **Report within 25 minutes.** Use port 5173 only; never start another dev server. **Never run `npx playwright test`** — 9 minutes; the orchestrator runs it once at the end.

## Global Constraints

- **No regressions.** 156 vitest, 120 pytest, 13 Playwright currently pass.
- **Honesty rule.** Modeled objects stay excluded from search and labels, exactly as they are from picking. A search result must never be an invented point.
- **Every layer is heliocentric**; the camera handover rescales the radius and never translates.
- **Commits** carry a `Phase: 3` trailer; no attribution trailers.

## Verified data source for L4

`VII/294/catalog` on VizieR — SDSS quasar catalogue with `RAJ2000`, `DEJ2000`, and **`z` (spectroscopic redshift)**. Confirmed reachable through `astroquery.vizier`.

SDSS SkyServer itself (`skyserver.sdss.org`) is **unreachable** — `ConnectTimeout`. Do not try `astroquery.sdss`; use VizieR.

Comoving distance from redshift via `astropy.cosmology.Planck18.comoving_distance(z)`. Quasars are real measured objects: they carry no `FLAG_MODELED`. They have no usable absolute magnitude for our purposes, so they take a nominal one and `FLAG_NOMINAL_MAGNITUDE`. Redshift gives no transverse motion, so velocity is zero with `FLAG_NO_RADIAL_VELOCITY`.

---

## Task A: Cosmic web source (L4)

**Files:** create `pipeline/universe_pipeline/sources/cosmic_web.py`, `pipeline/tests/test_cosmic_web.py`; modify `pipeline/universe_pipeline/config.py`, `pipeline/tests/test_config.py`

**Produces:**
- `L4_COSMIC_WEB: LayerConfig` — `key="cosmic-web"`, `unit="Mly"`, `unit_in_metres=MLY_IN_METRES`, `min_radius=200.0`, `max_radius=14000.0`, `origin="Milky Way"`, `max_points_per_tile=65536`. It overlaps L3 (which ends at 300 Mly) over 200–300 Mly, so the crossfade has a band.
- `QUASAR_CATALOG = "VII/294/catalog"`, `NOMINAL_QUASAR_ABS_MAG = -26.0` (quasars are genuinely that luminous; still flagged nominal because it is not measured per object)
- `redshift_to_comoving_mly(z) -> np.ndarray`
- `fetch_cosmic_web(cache_dir) -> dict[str, np.ndarray]` — the only networked function
- `normalise_cosmic_web(table, layer) -> tuple[ObjectRecord, list[str]]`

Reuse `write_cache_atomic` from `sources/gaia.py` and `icrs_to_galactic_cartesian` from `frames.py` (which takes **parsecs** — convert in and out, as `cosmicflows.py` does).

**Tests (offline, no network):** redshift→distance against known values from `Planck18`; the layer range filter; galactic-centre direction on +X; class is `CLASS_GALAXY`; nominal magnitude and no-radial-velocity flags set; `FLAG_MODELED` never set; names come back in `localId` order.

Then wire `--layer cosmic-web` into `cli.py`'s `_build_one` and bake it. Report object count, tile count, size, and the redshift and distance ranges.

---

## Task B: Search and fly-to

**Files:** create `app/src/interaction/search.ts`, `app/src/interaction/search.test.ts`, `app/src/ui/searchBox.ts`; modify `app/src/main.ts`

**Produces:**
- `interface SearchEntry { name: string; layerKey: string; localId: number; position: [number, number, number] }`
- `buildSearchIndex(layers): Promise<SearchEntry[]>` — reads each layer's `names.json` and its tiles' positions
- `search(index, query, limit?): SearchEntry[]` — case-insensitive, prefix matches ranked above substring matches, exact match first
- `class SearchBox` — an input plus a result list, `onPick(entry)` callback

**The fly-to is the interesting part.** Flying to a target in another layer must rescale the camera through `rescalePosition` at the handover, exactly as free flight does. Animate the camera to a viewing distance proportional to the target's own scale, not a fixed number — 1 AU from a planet and 1 Mly from a galaxy are both "close".

**Honesty:** modeled points have no names, so they cannot appear. Assert that in a test — a search index built over the milky-way layer must return zero results whose entry lacks a name, and 4,000,000 modeled points must contribute nothing.

Only small layers ship `names.json`; the stellar layer has none and must yield an empty contribution without erroring.

---

## Task C: Scale HUD

**Files:** create `app/src/ui/scaleHud.ts`, `app/src/ui/scaleHud.test.ts`; modify `app/src/main.ts`

**Produces:**
- `formatDistance(metres): string` — picks the natural unit (AU under a light-year, ly under a million, Mly beyond) with sensible precision
- `class ScaleHud` — shows distance from Earth, the active layer name, and the current unit; `update(distanceMetres, layerName)`

Tests cover unit selection at each boundary, that the value is never rendered in scientific notation, and that it degrades sensibly at zero.

Without this, large zoom levels are unreadable — you cannot tell 1,000 ly from 1 Gly.

---

## Task D: Maximum render distance

**Files:** modify `app/src/render/pointMaterial.ts`, `app/src/layers/layerRenderer.ts`, `app/src/tiles/traversal.ts`; create `app/src/ui/rangeControls.ts`, `app/src/ui/rangeControls.test.ts`; modify `app/src/main.ts`

Implements design spec §6.1. Read it before starting — the decisions there are deliberate.

**Two independent modes, both active simultaneously, intersecting:**
- **From Earth** — a radius shell on the layer origin. A map filter: what is visible does not change as the camera moves. **This is the default.**
- **From camera** — a draw distance that travels with the viewer.

**Hard cutoff, deliberately.** No fog, no fade band, no alpha ramp. A point is drawn at full brightness or not at all. The resulting popping is accepted and is recorded in the spec as a decision — do not soften it.

**Two tiers:** a shader uniform per mode discarding beyond the limit, and traversal culling so nodes entirely beyond the cutoff are never fetched. `distanceToBox` already measures node boxes against the camera, so camera-mode culling is nearly free; Earth-mode needs origin-to-box distance, which is static per node and can be computed once.

Cutoffs are in the **active layer's units**, and a value beyond the current layer's range constrains the outer layers rather than the current one.

---

## Task E: Auto-labels with decluttering

**Files:** create `app/src/interaction/labels.ts`, `app/src/interaction/labels.test.ts`; modify `app/src/main.ts`

**Produces:**
- `interface LabelCandidate { text: string; screenX: number; screenY: number; priority: number }`
- `declutter(candidates, boxSize, maxLabels): LabelCandidate[]` — highest priority first, dropping any whose box overlaps one already placed
- `class LabelLayer` — DOM labels driven per frame from the visible named objects

Pure `declutter` carries the tests: higher priority wins a collision, non-overlapping labels all survive, the cap is respected, and the result is deterministic for a given input.

Priority should favour nearer and brighter objects. Only named objects are candidates, so modeled points are excluded by construction.
