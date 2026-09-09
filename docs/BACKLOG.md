# Backlog

Known, non-blocking. Each is understood well enough to pick up cold.

## LOD tile seams

Rectangular brightness steps where octree levels meet — three or four concentric rounded-square steps at 350,000 ly, a bright square with hard vertical edges at 120,000 ly (in/out ratio 8.34).

Diagnosed: a point-**density** discontinuity, not a brightness deficit. Flux compensation is implemented and arithmetically exact (`Σ pointCount × fluxWeight` equals the root total at every distance) but has no visible effect, because `clamp(brightness * uAlphaScale, 0.02, 1.0)` and `clamp(…, 1.0, 8.0)` pin distant points to the floor — a 63% coverage that should brighten the frame 1.58× measured 1.0005×.

Next step: sweep those two floors downward now that tone mapping carries the range. Metric to move: the 120,000 ly box ratio toward 1.0, and the 350,000 ly radial profile losing its steps, without the galaxy vanishing at 1 Mly. **Meter with `setAutoExposure(false)`** — the controller otherwise compensates for exactly the change being measured.

Cosmetic. Does not block any feature.

## Sagittarius A* unpickable beyond ~2,000 ly

The 10 CSS px pick radius means whichever globular cluster wins the depth test covers it. At 40,000 ly hovering the galactic centre returns Terzan 9, NGC 6624, Terzan 5 — never the black hole. Fix would be a depth-aware or class-priority tiebreak in `picking.ts`.

## Earth anchor versus hover card wording

The permanent overlay says `EARTH`; the hover card says `from Sol`, since it reports the active layer's origin. Both defensible, together incoherent. Needs one decision, then a one-line change.

## Exposure weakens absolute-luminance assertions

Adaptive exposure brightens a dim frame toward a target, so a fixed-camera luminance assertion now partly measures the controller's setpoint rather than the field's density. `e2e/render.spec.ts` should meter with `setAutoExposure(false)` at a pinned exposure before asserting absolute values.

## The e2e suite is slow

8.7 minutes for 13 tests. `frame cost scales with the points drawn` is 3 minutes by itself. Several 6-second fixed waits could become `waitForIdleLoader` calls, which already exists in the spec.

## Auto-exposure pins at the cap beyond ~350,000 ly

`MAX_EXPOSURE` is 16 to protect the modeled-versus-measured dimming ratio, which compresses toward 1 as exposure rises. The far view is therefore slightly dimmer than target. Revisit only if the distant galaxies read as too dim in use.
