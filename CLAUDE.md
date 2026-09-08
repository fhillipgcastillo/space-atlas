# Universe Map — project specifics

3D map of the known universe. Offline Python pipeline bakes octree tiles from
astronomical catalogs; a TypeScript/Three.js app streams and renders them.
Design: `docs/superpowers/specs/2026-09-08-universe-map-design.md`

<!-- BEGIN vdf-project-specifics -->

## Project specifics

Python lives in `pipeline/` and runs from the repo-root venv at `.venv/`.
TypeScript lives in `app/`.

- **Test:** `npm test` and `.venv/Scripts/python -m pytest pipeline/tests`
- **Typecheck:** `npm run typecheck`
- **Lint:** `npm run lint` and `.venv/Scripts/python -m ruff check pipeline`
- **Build:** `npm run build`
- **Run a single flow:** `npm run dev` then open the printed URL
- **End-to-end:** `npm run test:e2e`

Tile data under `public/data/` is generated, never hand-edited, and never
committed. Regenerate with `.venv/Scripts/python -m universe_pipeline.cli`.

`docs/tile-format.md` is a frozen contract between the two halves. Changing it
means regenerating every tile and updating both codecs plus the cross-language
contract test.


## Commit conventions

Every commit carries a `Phase:` trailer naming the phase it belongs to, so the
log can be sliced by phase:

```
Phase: 2a
```

`git log --grep="Phase: 2a"` lists a phase; `git log --oneline --decorate`
shows the boundaries.

Each completed phase gets an annotated tag — `phase-1`, `phase-2a`, `phase-2b`
— on its final commit, whose message records what shipped, how it was
validated, and the test counts.

Phases: 1 stellar neighbourhood (done) · 2a layer stack · 2b cosmic web ·
2c Milky Way · 3 labels, search, HUD, render-distance controls · 4 time
playback · 5 deep-future extrapolation.

<!-- END vdf-project-specifics -->
