# Backlog

Known, non-blocking. Each is understood well enough to pick up cold.

## LOD tile seams — not reproducible, entry kept for the measurements

The original report was rectangular brightness steps where octree levels meet:
concentric rounded-square steps at 350,000 ly and a bright square with an
in/out ratio of 8.34 at 120,000 ly.

**Two independent attempts failed to reproduce it.** Radial mean-luminance
profiles metered through the composer with `setAutoExposure(false)` fall off
smoothly with no plateau or step — at 120,000 ly the largest second difference
is 3.77 on a 70-unit profile, at 350,000 ly it is 6.16 on a 154-unit profile.
That is a galactic-disk falloff, not seam rings. Most likely fixed as a side
effect of tone mapping and adaptive exposure rather than by anything aimed at
it.

Two measurements worth keeping, because they kill the proposed fix:

- **`uMinSize` is inert.** 1.0, 0.5 and 0.0 render identically to three decimal
  places at 120,000 ly, 350,000 ly and 1 Mly. GL clamps point size, so that
  floor can never be swept.
- **Lowering the alpha floor deletes light rather than rebalancing it.** At
  120,000 ly, 0.02 gives mean 10.820 / 52.5% lit; 0.005 gives 2.608 / 12.3%;
  0.001 gives 1.638 / 9.7%. The floor is carrying the far field, not distorting
  it, and sweeping it down makes core-to-background contrast worse (39 to 352)
  and the 350,000 ly radial profile raggeder.

Anyone reopening this must reproduce the 8.34 ratio first and record the camera
that shows it. `uMinAlpha` is now a uniform so the floor can be swept at runtime
without a rebuild.

## Sagittarius A* unpickable beyond ~2,000 ly

The 10 CSS px pick radius means whichever globular cluster wins the depth test covers it. At 40,000 ly hovering the galactic centre returns Terzan 9, NGC 6624, Terzan 5 — never the black hole. Fix would be a depth-aware or class-priority tiebreak in `picking.ts`.

## Earth anchor versus hover card wording

The permanent overlay says `EARTH`; the hover card says `from Sol`, since it reports the active layer's origin. Both defensible, together incoherent. Needs one decision, then a one-line change.

## Exposure weakens absolute-luminance assertions

Adaptive exposure brightens a dim frame toward a target, so a fixed-camera luminance assertion now partly measures the controller's setpoint rather than the field's density. `e2e/render.spec.ts` should meter with `setAutoExposure(false)` at a pinned exposure before asserting absolute values.

## TileManager's evict callback is only half identity-guarded

`tilesBySlot` deletion and the slot release sit behind a
`tilesBySlot.get(slot)?.mesh === mesh` check, but `meshes.delete(path)`
and `loader.forget(path)` in the same callback do not. On the
replace-in-place path — `TileCache.set` for a path already cached, which
fires `onEvict` for the *old* mesh — that erases the **new** mesh's
`meshes` entry, so `LayerRenderer.setUniform` would stop reaching it and
that tile would silently miss uniform updates such as the clock.

Looks unreachable today because the loader will not re-enqueue a cached
path, so it is an inconsistency rather than an observed defect. It is why
the "keeps a path on the slot it already holds" test asserts through
`tilesBySlot` rather than `meshes`. Fix is to move both deletes inside
the same guard.

## The Hubble time is duplicated between the shader and the CPU

`T_HUBBLE_YEARS = 13.97e9` is a GLSL `const` inside the shader string in
`pointMaterial.ts` and a separate local constant in
`app/src/interaction/hover.ts`. The two must agree or the hover card
reports a different distance from the one the renderer draws on the Mly
layers, and nothing catches a divergence.

Promote it to a shared export and import it in both. One line; it was
left only because `pointMaterial.ts` was out of scope for the change that
introduced the duplicate.

## The e2e suite is slow

8.7 minutes for 13 tests. `frame cost scales with the points drawn` is 3 minutes by itself. Several 6-second fixed waits could become `waitForIdleLoader` calls, which already exists in the spec.

## Auto-exposure pins at the cap beyond ~350,000 ly

`MAX_EXPOSURE` is 16 to protect the modeled-versus-measured dimming ratio, which compresses toward 1 as exposure rises. The far view is therefore slightly dimmer than target. Revisit only if the distant galaxies read as too dim in use.

## Search index costs ~103 MB of background traffic

`buildSearchIndex` finds a named object's position by walking the layer's tiles and matching `localId`. The Milky Way root tile holds only 35 of its 2,013 named objects and Sagittarius A* sits in the deepest tile, so a complete index reads essentially the whole tree — about 84 MB for milky-way plus 19 MB for cosmic-web, settling after roughly 36 seconds.

It never blocks startup and the small layers land in about a second, so this is a background cost rather than a stall.

The real fix is in the bake: write positions into `names.json` (or a `names.bin` beside it), which makes the index three requests and under a megabyte. An intermediate fix is HTTP Range requests for just the `localId` slice of each tile — the offset is derivable from `pointCount` in `tileset.json` — cutting it to about 20 MB.
