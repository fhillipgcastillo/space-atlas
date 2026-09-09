# Universe Map

A local-first 3D map of the known universe, from the solar system out to the
cosmic web. Every object is placed from real catalogue data — position,
distance and, where it was measured, velocity — and the clock can be run
forward and backward to watch the sky move.

Runs entirely on your machine. No CDN, no network at runtime.

## What is in it

| Layer | Objects | Source | Unit | Range |
|---|---|---|---|---|
| Solar system | 9 | astropy ephemeris | AU | 0–100 |
| Stellar neighbourhood | 32,750,394 | Gaia DR3 + Bailer-Jones distances | ly | 0.01–5,000 |
| Milky Way | 4,002,013 | modeled population + Harris globulars + Cantat-Gaudin open clusters | ly | 3,000–400,000 |
| Local universe | 10,651 | Cosmicflows-4 | Mly | 0.3–300 |
| Cosmic web | 423,578 | SDSS quasars | Mly | 200–14,000 |

The layers share a heliocentric origin and cross-fade into one another, so
flying outward from Earth crosses eleven orders of magnitude without a seam or
a loading screen.

## Quick start

```sh
npm install
python -m venv .venv && .venv/Scripts/pip install -e pipeline

# Bake tiles. The real Gaia layer is a large download; start with the fixture.
npm run bake:fixture                                    # 2M synthetic points
.venv/Scripts/python -m universe_pipeline.cli --all     # the real thing

npm run dev
```

Tile data lands in `public/data/`. It is generated, never committed, and about
1 GB baked in full.

Bake one layer at a time with `--layer <name>`, and tune the Gaia download with
`--chunks` and `--workers` (it is parallel across sky chunks; the archive, not
your connection, is usually the limit).

## Using it

Drag to look, `WASD` to fly — speed scales with how far out you are. Hover
anything to identify it. Search by name to fly there across layers. Earth and
the Milky Way are permanently labelled; other labels appear and declutter as
they become relevant.

The time control runs the clock to ±1,000,000 years on measured velocities.
Switching on **deep time** extends that to ±250,000,000 — about one galactic
year — and swaps the straight-line model for orbits in the galactic potential,
so the disk shears differentially instead of flying apart.

## Honesty

The map is built so it cannot quietly mislead, which is a stronger requirement
than being accurate. Wherever it shows something it did not measure, it says so
in place:

- **49% of Gaia stars have no measured radial velocity.** Their motion is
  transverse only, with zero substituted for the missing component. Run the
  clock and they drift in a direction that is partly right and confidently
  wrong. The time disclosure names the fraction for whatever is on screen.
- **The 4,000,000-point Milky Way population is modeled, not observed** —
  galactic dust hides most of the Galaxy from Gaia. Those points are dimmed,
  excluded from hover, and announced whenever they are visible.
- **Magnitudes that were assumed rather than measured are marked nominal.**
- **Extrapolation has a stated expiry.** Linear motion is 1.4% wrong at 1 Myr
  and 13.9% at 10 Myr, which is why the basic range stops at a million years.
  The orbit model is about 5% of galactocentric radius off at 250 Myr, which is
  why deep time stops there. Both bounds were measured against an RK4
  integration, not asserted.

## Commands

| | |
|---|---|
| `npm run dev` | run it |
| `npm test` | unit tests |
| `npm run test:e2e` | full Playwright suite (~18 min) |
| `npm run test:e2e:fast` | everything except the perf test (~15 min) |
| `npm run test:e2e:<group>` | one area only — see below |
| `npm run typecheck` / `npm run lint` / `npm run build` | |
| `.venv/Scripts/python -m pytest pipeline/tests` | pipeline tests |

### Running only the tests you need

The end-to-end suite runs single-worker against a software rasteriser, so a
full pass is ~18 minutes. Every test carries a tag, so you can run just the
area you touched:

| Script | Tag | Tests | Run it after touching |
|---|---|---|---|
| `test:e2e:core` | `@core` | 3 | tile format, streaming, loader |
| `test:e2e:layers` | `@layers` | 5 | the layer stack, crossfades, units |
| `test:e2e:time` | `@time`, `@deep` | 8 | the clock, orbits, disclosures |
| `test:e2e:hover` | `@hover`, `@modeled` | 5 | picking, hover card, modeled flags |
| `test:e2e:render` | `@render`, `@labels` | 5 | shaders, brightness, labels, anchors |
| `test:e2e:perf` | `@perf` | 1 | LOD or the byte budget |
| `test:e2e:fast` | all but `@perf` | 20 | anything, when you can skip the 3-minute perf test |

`npm run test:e2e:list` lists every test by name; it does not print tags, so to
see what a group covers run that script with `-- --grep @tag --list`. Tags
compose, so a test can belong to more than one group and the groups above
overlap deliberately.

Run the full suite before tagging a phase or shipping. Unit tests
(`npm test`, ~2 s) and `npm run typecheck` are cheap enough to run on
every change.

## How it works

An offline Python pipeline bakes catalogues into an additive-refinement octree
(the Potree scheme: each parent holds a uniform random subsample of its
descendants), written in a custom binary format. The browser streams tiles by
screen-space error under a GPU byte budget, and draws them as GPU points with
size and brightness from apparent magnitude.

- `docs/superpowers/specs/2026-09-08-universe-map-design.md` — the design, and
  the reasoning behind the parts that look arbitrary
- `docs/tile-format.md` — the binary format, frozen as a contract between the
  pipeline and the renderer
- `docs/BACKLOG.md` — known, deliberately deferred work
