# Phase 4 — Time Playback Implementation Plan

**Goal:** Run the clock forward and backward and watch the sky move on measured velocities.

**Architecture:** Position becomes `p₀ + v·t` in the vertex shader. Velocity has been a resident per-point attribute since Phase 1 — uploaded as `HALF_FLOAT`, never read until now — so this needs no pipeline change and no re-bake. A single `uTimeYears` uniform drives every layer.

## Execution protocol

`builder` subagents, one per task. Tests are the oracle. No `git`. **Report within 25 minutes.** Use port 5173 only; never start another dev server. **Never run `npx playwright test`** — 10 minutes; the orchestrator runs it once at the end.

## Global Constraints

- **No regressions.** 217 vitest, 134 pytest, 13 Playwright currently pass.
- **No pipeline change, no re-bake.** Velocity is already in every tile.
- **Commits** carry a `Phase: 4` trailer; no attribution trailers.

## The honesty problem, and it is the whole design here

Time playback is where this project can most easily lie, in three distinct ways:

**1. Half the stars have no measured radial velocity.** 49% of the Gaia layer carries `FLAG_NO_RADIAL_VELOCITY` — their stored velocity is transverse only, with zero substituted for the unmeasured component. Run the clock and they drift in a direction that is *partly* right and confidently wrong. This must be visible, not buried.

**2. The modeled population has no kinematics at all.** All 4,000,000 generated Milky Way points carry zero velocity by deliberate choice. They will sit perfectly still while everything moves around them — which is correct, and would look like a bug to anyone who did not know. The notice must say so.

**3. Linear extrapolation expires.** `p₀ + v·t` holds for roughly a million years before galactic orbits curve away from straight lines. Beyond that the map is showing a fiction. The control must not offer a range it cannot honour.

Galaxies are a fourth case: `Vpec` is a line-of-sight peculiar velocity, so they move radially only, and the Hubble flow is not modelled at all.

---

## Task 1: Time in the shader

**Files:** modify `app/src/render/pointMaterial.ts`, `app/src/layers/layerRenderer.ts`, `app/src/core/viewer.ts`; create `app/src/render/timeline.ts`, `app/src/render/timeline.test.ts`

**Produces:**
- `MAX_YEARS = 1_000_000` and `MIN_YEARS = -1_000_000` — the bound beyond which linear extrapolation stops being defensible
- `clampYears(years: number): number`
- `formatYears(years: number): string` — `present day`, `+12,400 years`, `−340,000 years`; thousands separated, never scientific notation
- `velocityScaleForLayer(unitInMetres: number): number` — converts km/s into layer-units-per-year, so the shader multiplies a single scalar
- `Viewer.setTimeYears(years)`, `Viewer.getTimeYears()`

**The unit conversion is the whole risk.** Velocity is stored in km/s; positions are in the layer's own unit. One year of drift at 30 km/s is about 6.3 AU, 1e-4 ly, or 1e-10 Mly — three layers, three scales, and a wrong factor moves stars by a plausible-looking amount that is silently wrong by orders of magnitude.

Pin it with a test using a known case: **Barnard's Star moves 10.3 arcseconds per year**, and at 30 km/s a star drifts 1 parsec in roughly 9,800 years. Assert the scale factor reproduces a hand-computed displacement in each of AU, ly and Mly.

In the vertex shader, apply the offset before the bounding-box dequantisation is used for distance:

```glsl
vec3 layerPosition = uBboxMin + position * uBboxExtent + aVelocity * uTimeYears * uVelocityScale;
```

`aVelocity` needs adding as a `Float16BufferAttribute` in `tileMesh.ts` — the decoded tile already exposes `velocity` as raw float16 bits, uploaded as `HALF_FLOAT` with no CPU conversion. Note that `tileMesh.ts` is not in the file list above; add it and say so.

`uTimeYears` is uniform across a layer, so it goes through `layerRenderer.ts`'s existing `setUniform` helper, which writes the base material and every live mesh — a uniform set only on the base never reaches streamed tiles.

**Tests:** `clampYears` at both bounds and beyond; `formatYears` for zero, positive, negative, and a value large enough to tempt scientific notation; `velocityScaleForLayer` against hand-computed displacements in all three units.

---

## Task 2: The time control and its disclosure

**Files:** create `app/src/ui/timeControls.ts`, `app/src/ui/timeControls.test.ts`; modify `app/src/main.ts`

**Produces:**
- `class TimeControls` — a slider over `MIN_YEARS…MAX_YEARS`, a readout using `formatYears`, play/pause with a rate control, and a reset to present day. `data-testid="time-controls"`.
- `timeDisclosure(stats: { noRadialVelocityFraction: number; modeledFraction: number }): string` — the pure part, and where the tests go.

**The disclosure appears only while the clock is off present day**, and must state plainly:
- what fraction of the visible layer has no measured radial velocity, and that their motion is transverse only
- that the modeled population does not move because it has no measured kinematics
- that beyond about a million years the straight-line extrapolation stops being physical

Tests on `timeDisclosure`: it names a real percentage rather than a vague qualifier; it mentions the modeled population only when that fraction is above zero; it never claims motion is measured when the fraction without radial velocity is high; it is stable for the same input.

Default state is present day, clock paused — the map opens showing today, not a simulation.

---

## Task 3: Verify and hand off

**Files:** modify `e2e/render.spec.ts`

Add tests that: the time control exists and starts at present day; setting a time visibly moves the field (measure mean luminance change or sample a point's projected position before and after); the disclosure appears off present day and disappears at zero; and the modeled population does **not** move while measured stars do.

That last one is the honesty guarantee in test form. Sample a modeled point and a measured point through `manager.tilesBySlot`, step the clock, and assert only the measured one has moved.

Then run the full suite once, look at it in the browser, and report.
