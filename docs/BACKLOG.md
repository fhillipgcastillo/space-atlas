# Backlog

Known, non-blocking. Each is understood well enough to pick up cold.

## LOD tile seams - FIXED, kept for the measurements

Reported as rectangular brightness steps. Two attempts on a software
rasteriser failed to reproduce it and it was nearly retired; it is real, and
only shows on a GPU. Found on an RTX 3060 as a hard-edged rectangle in the
Milky Way core with a horizontal seam splitting it into two densities.

Cause: the point budget was starving refinement. Of 77 drawn tiles the median
flux weight was exactly 1.0 while seven carried up to 30.6 -- a fully refined
node touching a coarse one asked to be thirty times brighter, which nothing
survives past the alpha ceiling of 1.0 and the point size cap.

Fixed by raising the point budget from 1.5M to 6M (same 131 fps, worst weight
falls to 4.8), refining sibling groups atomically, and scaling the size ceiling
by the flux weight rather than globally.

Two measurements worth keeping:

- **`uMinSize` is inert.** 1.0, 0.5 and 0.0 render identically at every
  distance tested. GL clamps point size; that floor can never be swept.
- **Lowering the alpha floor deletes light rather than rebalancing it.** At
  120,000 ly, 0.02 gives 52.5% lit; 0.001 gives 9.7%.

**Never measure this on SwiftShader.** The software path did not show the
artifact at all, and two rounds were wasted concluding it was gone.

## Notable objects are not exempt from LOD

Nothing guarantees a named object, a black hole or an anchor survives node
selection, so an object can vanish at distance and pop back in on approach.

Deferred rather than built, because the cause of the reported symptom turned
out to be budget starvation, and raising the point budget to 6M fixed it: the
Milky Way layer now draws every visible tile. The guarantee is still missing,
and matters most for the stellar layer, where 32.7M points across 1,705 nodes
cannot all be resident.

Doing it properly needs the bake to record which nodes contain notable objects,
so the traversal can force them in regardless of budget -- a tileset change, not
a renderer one. The cheaper alternative, drawing them as a separate overlay from
the search index, is unattractive: that index costs about 103 MB of background
traffic and takes ~36 s to settle, so the overlay would arrive late and cost
more than it saves.

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
