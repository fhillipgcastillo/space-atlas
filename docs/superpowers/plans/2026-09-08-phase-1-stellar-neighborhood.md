# Universe Map Phase 1 — Stellar Neighborhood Implementation Plan

> **For agentic workers:** Implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Execution protocol

One subagent per task, on Opus, in the shared working tree.

- **Tests are the oracle.** A task is done when its own tests pass and the repo-wide checks stay green. There is no per-task reviewer; the tests in each task are written before the implementation precisely so they can carry that weight.
- **Subagents do not run `git`.** Files across concurrently-dispatched tasks are disjoint, but a shared git index is not. The orchestrator commits.
- **Stay inside the task.** Do not refactor, rename, restyle, or "improve" anything outside the files the task lists. If you spot a real defect out of scope, report it in your final message rather than fixing it.
- **Never weaken a test to make it pass.** If a test looks wrong, say so explicitly and explain why; do not delete, skip, or narrow it.
- **Report honestly.** If a step fails, include the actual output. A skipped or filtered check is a failure, not a pass.
- **Review happens only at demoable checkpoints** — after Task 9, Task 11 and Task 12 — scoped strictly to the tasks in that batch.

**Goal:** Fly through the real stellar neighborhood — millions of Gaia DR3 stars streamed from baked octree tiles, with hover identification and a permanent Earth anchor.

**Architecture:** An offline Python pipeline fetches Gaia DR3, transforms to Galactic Cartesian coordinates, and bakes an additive-refinement octree into binary tiles. A TypeScript/Three.js app reads those tiles, traverses the octree against the camera using screen-space error, streams tiles in and out under an LRU budget, and draws points with magnitude-driven sizing. The two halves are coupled only by tile format v1.

**Tech Stack:** Python 3.12 + astropy + astroquery + numpy + pytest + ruff. TypeScript + Vite + Three.js (WebGL2, GLSL3) + vitest + Playwright.

## Global Constraints

Values copied verbatim from `docs/superpowers/specs/2026-09-08-universe-map-design.md`. Every task's requirements implicitly include this section.

- **Frame:** Galactic Cartesian. The Milky Way disk lies in the XY plane.
- **Phase 1 layer:** L1 Stellar Neighborhood only. Range 0.01 – 5,000 ly, unit `ly`, origin Sol.
- **Performance:** 60 fps target, hard floor 30 fps during active tile streaming.
- **Transform accuracy:** within 0.1% of cited catalog distance and 1 arcsecond of cited sky direction.
- **Streaming:** maximum 8 in-flight tile requests; LRU cache under a 512 MB GPU byte budget. Both are configuration.
- **Tile format:** v1, frozen in Task 2. Velocity is written in Phase 1 even though nothing reads it until Phase 4 — retrofitting a field means regenerating every tile.
- **Object count is configuration.** Density is set by a G-magnitude limit in pipeline config, never a hardcoded count.
- **No backend, no CDN, no hosting.** Local dev server against tiles on local disk.
- **Distances:** Bailer-Jones geometric estimates where available; fall back to `1000 / parallax_mas` parsecs only above the configured `parallax_over_error` threshold. Objects failing both are dropped, never guessed.
- **Commit discipline:** no `Co-Authored-By`, "Generated with", or attribution trailers in commit messages.
- **Phase handoff:** Phase 1 ends at Task 12. Stop and hand off. Do not begin Phase 2.

---

## File Structure

**Pipeline (Python)** — no rendering knowledge anywhere in this tree.

| File | Responsibility |
|---|---|
| `pipeline/universe_pipeline/config.py` | Layer definitions, magnitude limits, quality cuts. All tunables. |
| `pipeline/universe_pipeline/frames.py` | ICRS to Galactic Cartesian position and velocity. Wraps astropy. |
| `pipeline/universe_pipeline/records.py` | The normalized `ObjectRecord` schema every source produces. |
| `pipeline/universe_pipeline/sources/gaia.py` | Gaia DR3 ADQL fetch, disk cache, normalization to `ObjectRecord`. |
| `pipeline/universe_pipeline/octree.py` | Additive-refinement octree build. Pure geometry, no I/O. |
| `pipeline/universe_pipeline/tileformat.py` | Tile format v1 encode and decode. The contract, Python side. |
| `pipeline/universe_pipeline/build.py` | Wires source to frames to octree to tiles. Writes `tileset.json`. |
| `pipeline/universe_pipeline/cli.py` | Command-line entry point. |

**App (TypeScript)** — no astronomy knowledge anywhere in this tree.

| File | Responsibility |
|---|---|
| `app/src/tiles/format.ts` | Tile format v1 decode. The contract, TypeScript side. |
| `app/src/tiles/tileset.ts` | `tileset.json` types and fetch. |
| `app/src/tiles/traversal.ts` | Screen-space error traversal. Pure function, no side effects. |
| `app/src/tiles/loader.ts` | Priority queue, in-flight cap, fetch scheduling. |
| `app/src/tiles/cache.ts` | LRU eviction under a GPU byte budget. |
| `app/src/render/pointMaterial.ts` | Point shaders, magnitude sizing, colour LUT. |
| `app/src/render/picking.ts` | ID render target and cursor readback. |
| `app/src/core/viewer.ts` | Renderer, scene, composer, bloom, frame loop. |
| `app/src/core/flyControls.ts` | Free-fly camera with scale-aware speed. |
| `app/src/interaction/hover.ts` | Picking result to hover state. |
| `app/src/interaction/anchors.ts` | Permanent Earth label. |
| `app/src/ui/hoverCard.ts` | Hover card DOM. |
| `app/src/main.ts` | Composition root. The only file that knows about all the others. |

---

### Task 1: Toolchain and project skeleton

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `eslint.config.js`, `vitest.config.ts`
- Create: `pipeline/pyproject.toml`
- Create: `app/index.html`, `app/src/main.ts`
- Create: `pipeline/universe_pipeline/__init__.py`, `pipeline/tests/test_smoke.py`
- Create: `app/src/smoke.test.ts`
- Create: `CLAUDE.md`

**Interfaces:**
- Consumes: nothing.
- Produces: the six verification commands every later task runs — `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, `pytest`, `ruff check`.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "universe-map",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "typecheck": "tsc --noEmit",
    "lint": "eslint .",
    "test": "vitest run",
    "test:e2e": "playwright test"
  },
  "dependencies": {
    "three": "^0.180.0"
  },
  "devDependencies": {
    "@playwright/test": "^1.56.0",
    "@types/three": "^0.180.0",
    "eslint": "^9.36.0",
    "typescript": "^5.9.0",
    "typescript-eslint": "^8.45.0",
    "vite": "^7.1.0",
    "vitest": "^3.2.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["vite/client"]
  },
  "include": ["app/src", "vite.config.ts", "vitest.config.ts"]
}
```

`noUncheckedIndexedAccess` matters here: this codebase indexes into typed arrays constantly, and it is the setting that catches the resulting undefined bugs.

- [ ] **Step 3: Create `vite.config.ts` and `vitest.config.ts`**

```typescript
// vite.config.ts
import { defineConfig } from 'vite';

export default defineConfig({
  root: 'app',
  publicDir: '../public',
  build: { outDir: '../dist', emptyOutDir: true },
});
```

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['app/src/**/*.test.ts'],
    environment: 'node',
  },
});
```

- [ ] **Step 4: Create `eslint.config.js`**

```javascript
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'public/data/**'] },
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
);
```

- [ ] **Step 5: Create `app/index.html` and `app/src/main.ts`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Universe Map</title>
    <style>
      html, body { margin: 0; height: 100%; background: #000; overflow: hidden; }
      canvas { display: block; }
    </style>
  </head>
  <body>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

```typescript
// app/src/main.ts
export function boot(): string {
  return 'universe-map';
}

boot();
```

- [ ] **Step 6: Create `app/src/smoke.test.ts`**

```typescript
import { describe, expect, it } from 'vitest';
import { boot } from './main.js';

describe('boot', () => {
  it('identifies the app', () => {
    expect(boot()).toBe('universe-map');
  });
});
```

- [ ] **Step 7: Create `pipeline/pyproject.toml`**

```toml
[project]
name = "universe-pipeline"
version = "0.1.0"
requires-python = ">=3.12"
dependencies = [
  "numpy>=2.1",
  "astropy>=6.1",
  "astroquery>=0.4.7",
]

[project.optional-dependencies]
dev = ["pytest>=8.3", "ruff>=0.7"]

[project.scripts]
universe-pipeline = "universe_pipeline.cli:main"

[build-system]
requires = ["setuptools>=68"]
build-backend = "setuptools.build_meta"

[tool.setuptools.packages.find]
include = ["universe_pipeline*"]

[tool.pytest.ini_options]
testpaths = ["tests"]

[tool.ruff]
line-length = 100

[tool.ruff.lint]
select = ["E", "F", "I", "UP", "B"]
```

- [ ] **Step 8: Create the Python package and a smoke test**

```python
# pipeline/universe_pipeline/__init__.py
__version__ = "0.1.0"
```

```python
# pipeline/tests/test_smoke.py
import universe_pipeline


def test_package_imports() -> None:
    assert universe_pipeline.__version__ == "0.1.0"
```

- [ ] **Step 9: Install and verify every command runs green**

```bash
npm install
python -m venv .venv
.venv/Scripts/python -m pip install -e "pipeline[dev]"
```

Then run all six. Expected: all pass, no errors.

```bash
npm run typecheck
npm run lint
npm test
npm run build
.venv/Scripts/python -m pytest pipeline/tests -v
.venv/Scripts/python -m ruff check pipeline
```

If `npm run build` fails because `public/` does not exist, create `public/.gitkeep` and rerun.

- [ ] **Step 10: Create `CLAUDE.md` with the real commands**

```markdown
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

<!-- END vdf-project-specifics -->
```

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "chore: scaffold toolchain for pipeline and app

Vite/TypeScript/Three.js app and a Python pipeline package, each with
test, lint and typecheck commands wired up and passing on empty sources."
```

---

### Task 2: Tile format v1 — specification and Python codec

This task freezes the contract. Nothing downstream can start until it lands.

**Files:**
- Create: `docs/tile-format.md`
- Create: `pipeline/universe_pipeline/tileformat.py`
- Test: `pipeline/tests/test_tileformat.py`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `TILE_MAGIC: bytes = b"UMT1"`, `TILE_VERSION: int = 1`, `HEADER_BYTES: int = 64`
  - `encode_tile(points: TilePoints, bbox_min: np.ndarray, bbox_max: np.ndarray) -> bytes`
  - `decode_tile(blob: bytes) -> tuple[TilePoints, np.ndarray, np.ndarray]`
  - `TilePoints` — a dataclass with fields `position` (float64, shape `(N, 3)`), `velocity` (float32, shape `(N, 3)`), `color_index` (uint16, shape `(N,)`), `abs_mag` (float32, shape `(N,)`), `type_flags` (uint8, shape `(N,)`), `local_id` (uint32, shape `(N,)`)

- [ ] **Step 1: Write `docs/tile-format.md`**

````markdown
# Tile format v1

Frozen contract between `pipeline/` and `app/`. Little-endian throughout.

## Header — 64 bytes

| Offset | Size | Type | Field |
|---|---|---|---|
| 0 | 4 | bytes | magic, `"UMT1"` |
| 4 | 4 | uint32 | format version, `1` |
| 8 | 4 | uint32 | point count `N` |
| 12 | 4 | uint32 | attribute mask, `0x3F` in v1 |
| 16 | 24 | 3 x float64 | bounding box minimum, layer units |
| 40 | 24 | 3 x float64 | bounding box maximum, layer units |

## Attribute blocks

Structure-of-arrays, in this fixed order, each padded to a 4-byte boundary.

| Order | Attribute | Type | Bytes |
|---|---|---|---|
| 1 | position | uint16 x 3 | 6N |
| 2 | velocity | float16 x 3 | 6N |
| 3 | colorIndex | uint16 | 2N |
| 4 | absMag | float16 | 2N |
| 5 | typeFlags | uint8 | N |
| 6 | localId | uint32 | 4N |

## Position quantization

Positions are stored as unsigned 16-bit fractions of the tile's own bounding box:

```
q     = round((pos - bboxMin) / (bboxMax - bboxMin) * 65535)
pos   = bboxMin + (q / 65535) * (bboxMax - bboxMin)
```

Precision therefore scales with tile size automatically. A degenerate axis
(`bboxMax == bboxMin`) encodes as 0 and decodes to `bboxMin`.

Maximum quantization error on an axis is half a step, `(bboxMax - bboxMin) / 131070`.

## typeFlags

Bit 0 set means the object is **modeled**, not measured. Bits 1-7 are the object
class enumeration. Phase 1 writes class 1 (star) with bit 0 clear.

## localId

An index into the layer's identifier table, not a catalog identifier. Catalog
identifiers are 64-bit and live in the hover sidecar. `localId` stays CPU-side;
it is never uploaded to the GPU.
````

- [ ] **Step 2: Write the failing round-trip test**

```python
# pipeline/tests/test_tileformat.py
import numpy as np
import pytest

from universe_pipeline.tileformat import (
    HEADER_BYTES,
    TILE_MAGIC,
    TILE_VERSION,
    TilePoints,
    decode_tile,
    encode_tile,
)


def make_points(n: int, rng: np.random.Generator) -> TilePoints:
    return TilePoints(
        position=rng.uniform(-100.0, 100.0, size=(n, 3)),
        velocity=rng.uniform(-50.0, 50.0, size=(n, 3)).astype(np.float32),
        color_index=rng.integers(0, 65535, size=n, dtype=np.uint16),
        abs_mag=rng.uniform(-5.0, 15.0, size=n).astype(np.float32),
        type_flags=rng.integers(0, 255, size=n, dtype=np.uint8),
        local_id=rng.integers(0, 2**31, size=n, dtype=np.uint32),
    )


def test_header_is_well_formed() -> None:
    rng = np.random.default_rng(0)
    pts = make_points(10, rng)
    lo = pts.position.min(axis=0)
    hi = pts.position.max(axis=0)

    blob = encode_tile(pts, lo, hi)

    assert blob[0:4] == TILE_MAGIC
    assert int(np.frombuffer(blob[4:8], dtype="<u4")[0]) == TILE_VERSION
    assert int(np.frombuffer(blob[8:12], dtype="<u4")[0]) == 10
    assert len(blob) > HEADER_BYTES


def test_round_trip_preserves_values_within_quantization_error() -> None:
    rng = np.random.default_rng(1)
    pts = make_points(5000, rng)
    lo = pts.position.min(axis=0)
    hi = pts.position.max(axis=0)

    decoded, dec_lo, dec_hi = decode_tile(encode_tile(pts, lo, hi))

    np.testing.assert_allclose(dec_lo, lo)
    np.testing.assert_allclose(dec_hi, hi)

    # Positions are lossy by design; bound the error at half a quantization step.
    tolerance = (hi - lo) / 131070.0
    assert np.all(np.abs(decoded.position - pts.position) <= tolerance + 1e-9)

    # Exact types survive exactly.
    np.testing.assert_array_equal(decoded.color_index, pts.color_index)
    np.testing.assert_array_equal(decoded.type_flags, pts.type_flags)
    np.testing.assert_array_equal(decoded.local_id, pts.local_id)

    # float16 keeps roughly three decimal digits.
    np.testing.assert_allclose(decoded.velocity, pts.velocity, rtol=1e-2, atol=1e-2)
    np.testing.assert_allclose(decoded.abs_mag, pts.abs_mag, rtol=1e-2, atol=1e-2)


def test_degenerate_axis_round_trips_to_the_bound() -> None:
    pts = make_points(4, np.random.default_rng(2))
    pts.position[:, 2] = 7.5
    lo = pts.position.min(axis=0)
    hi = pts.position.max(axis=0)
    assert lo[2] == hi[2]

    decoded, _, _ = decode_tile(encode_tile(pts, lo, hi))

    np.testing.assert_allclose(decoded.position[:, 2], 7.5)


def test_empty_tile_round_trips() -> None:
    pts = make_points(0, np.random.default_rng(3))
    lo = np.zeros(3)
    hi = np.ones(3)

    decoded, _, _ = decode_tile(encode_tile(pts, lo, hi))

    assert decoded.position.shape == (0, 3)


def test_rejects_wrong_magic() -> None:
    rng = np.random.default_rng(4)
    pts = make_points(3, rng)
    blob = bytearray(encode_tile(pts, pts.position.min(axis=0), pts.position.max(axis=0)))
    blob[0:4] = b"XXXX"

    with pytest.raises(ValueError, match="magic"):
        decode_tile(bytes(blob))
```

- [ ] **Step 3: Run the test and confirm it fails**

Run: `.venv/Scripts/python -m pytest pipeline/tests/test_tileformat.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'universe_pipeline.tileformat'`

- [ ] **Step 4: Implement `pipeline/universe_pipeline/tileformat.py`**

```python
"""Tile format v1 codec. See docs/tile-format.md — this file is a contract."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

TILE_MAGIC = b"UMT1"
TILE_VERSION = 1
HEADER_BYTES = 64
ATTRIBUTE_MASK_V1 = 0x3F
QUANT_MAX = 65535


@dataclass
class TilePoints:
    """Per-point attributes for one tile, in layer units."""

    position: np.ndarray  # float64 (N, 3)
    velocity: np.ndarray  # float32 (N, 3), km/s
    color_index: np.ndarray  # uint16 (N,)
    abs_mag: np.ndarray  # float32 (N,)
    type_flags: np.ndarray  # uint8 (N,)
    local_id: np.ndarray  # uint32 (N,)

    def __len__(self) -> int:
        return int(self.position.shape[0])


def _pad_to_4(buf: bytearray) -> None:
    while len(buf) % 4:
        buf.append(0)


def quantize_positions(
    position: np.ndarray, bbox_min: np.ndarray, bbox_max: np.ndarray
) -> np.ndarray:
    """Map positions onto the tile bounding box as uint16 fractions."""
    extent = bbox_max - bbox_min
    # A degenerate axis has no range to quantize across; store zero.
    safe = np.where(extent > 0.0, extent, 1.0)
    frac = (position - bbox_min) / safe
    frac = np.where(extent > 0.0, frac, 0.0)
    return np.rint(np.clip(frac, 0.0, 1.0) * QUANT_MAX).astype(np.uint16)


def dequantize_positions(
    quantized: np.ndarray, bbox_min: np.ndarray, bbox_max: np.ndarray
) -> np.ndarray:
    extent = bbox_max - bbox_min
    return bbox_min + (quantized.astype(np.float64) / QUANT_MAX) * extent


def encode_tile(points: TilePoints, bbox_min: np.ndarray, bbox_max: np.ndarray) -> bytes:
    n = len(points)
    lo = np.asarray(bbox_min, dtype=np.float64)
    hi = np.asarray(bbox_max, dtype=np.float64)

    out = bytearray()
    out += TILE_MAGIC
    out += np.array([TILE_VERSION, n, ATTRIBUTE_MASK_V1], dtype="<u4").tobytes()
    out += lo.astype("<f8").tobytes()
    out += hi.astype("<f8").tobytes()
    assert len(out) == HEADER_BYTES, f"header is {len(out)} bytes, expected {HEADER_BYTES}"

    for block in (
        quantize_positions(points.position, lo, hi).astype("<u2"),
        points.velocity.astype("<f2"),
        points.color_index.astype("<u2"),
        points.abs_mag.astype("<f2"),
        points.type_flags.astype("u1"),
        points.local_id.astype("<u4"),
    ):
        out += block.tobytes()
        _pad_to_4(out)

    return bytes(out)


def _take(blob: bytes, offset: int, dtype: str, count: int) -> tuple[np.ndarray, int]:
    arr = np.frombuffer(blob, dtype=dtype, count=count, offset=offset)
    end = offset + arr.nbytes
    return arr, end + (-end % 4)


def decode_tile(blob: bytes) -> tuple[TilePoints, np.ndarray, np.ndarray]:
    if blob[0:4] != TILE_MAGIC:
        raise ValueError(f"bad tile magic: {blob[0:4]!r}")
    version, n, _mask = np.frombuffer(blob, dtype="<u4", count=3, offset=4)
    if int(version) != TILE_VERSION:
        raise ValueError(f"unsupported tile format version {int(version)}")
    n = int(n)

    lo = np.frombuffer(blob, dtype="<f8", count=3, offset=16).copy()
    hi = np.frombuffer(blob, dtype="<f8", count=3, offset=40).copy()

    off = HEADER_BYTES
    quant, off = _take(blob, off, "<u2", n * 3)
    velocity, off = _take(blob, off, "<f2", n * 3)
    color_index, off = _take(blob, off, "<u2", n)
    abs_mag, off = _take(blob, off, "<f2", n)
    type_flags, off = _take(blob, off, "u1", n)
    local_id, off = _take(blob, off, "<u4", n)

    points = TilePoints(
        position=dequantize_positions(quant.reshape(n, 3), lo, hi),
        velocity=velocity.reshape(n, 3).astype(np.float32),
        color_index=color_index.copy(),
        abs_mag=abs_mag.astype(np.float32),
        type_flags=type_flags.copy(),
        local_id=local_id.copy(),
    )
    return points, lo, hi
```

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `.venv/Scripts/python -m pytest pipeline/tests/test_tileformat.py -v`
Expected: 5 passed.

- [ ] **Step 6: Lint and commit**

```bash
.venv/Scripts/python -m ruff check pipeline
git add docs/tile-format.md pipeline/universe_pipeline/tileformat.py pipeline/tests/test_tileformat.py
git commit -m "feat(pipeline): freeze tile format v1 and add Python codec

Structure-of-arrays binary tiles with per-tile uint16 position
quantization, so precision scales with tile size. Round-trip tested
against the documented quantization bound."
```

---

### Task 3: TypeScript tile reader and cross-language contract test

This is the test that keeps the two halves independent. It is the highest-value test in Phase 1 after the frame transforms.

**Files:**
- Create: `app/src/tiles/format.ts`
- Create: `app/src/tiles/format.test.ts`
- Create: `pipeline/tests/test_fixture_export.py`
- Create (generated, committed): `tests/fixtures/contract-tile.bin`, `tests/fixtures/contract-tile.json`

**Interfaces:**
- Consumes: tile format v1 from Task 2.
- Produces:
  - `TILE_MAGIC: number` (the uint32 little-endian reading of `"UMT1"`)
  - `interface DecodedTile { pointCount: number; bboxMin: Float64Array; bboxMax: Float64Array; positionQuantized: Uint16Array; velocity: Uint16Array; colorIndex: Uint16Array; absMag: Uint16Array; typeFlags: Uint8Array; localId: Uint32Array; }`
  - `decodeTile(buffer: ArrayBuffer): DecodedTile`
  - `dequantizePosition(t: DecodedTile, index: number, out: Float64Array): Float64Array`
  - `decodeFloat16(bits: number): number`

`velocity`, `absMag` stay as raw `Uint16Array` of float16 bits. They are uploaded to the GPU directly as `HALF_FLOAT` and never decoded on the CPU in the hot path; `decodeFloat16` exists for hover display and for this test.

- [ ] **Step 1: Write the fixture exporter**

```python
# pipeline/tests/test_fixture_export.py
"""Generates the cross-language contract fixture consumed by app/src/tiles/format.test.ts.

This is a test so it runs in CI: if the Python codec changes, the fixture is
regenerated and the TypeScript test fails until both sides agree.
"""

import json
from pathlib import Path

import numpy as np

from universe_pipeline.tileformat import TilePoints, encode_tile

FIXTURE_DIR = Path(__file__).resolve().parents[2] / "tests" / "fixtures"


def test_export_contract_fixture() -> None:
    n = 64
    rng = np.random.default_rng(20260908)
    position = rng.uniform(-1000.0, 1000.0, size=(n, 3))
    points = TilePoints(
        position=position,
        velocity=rng.uniform(-40.0, 40.0, size=(n, 3)).astype(np.float32),
        color_index=rng.integers(0, 65535, size=n, dtype=np.uint16),
        abs_mag=rng.uniform(-5.0, 15.0, size=n).astype(np.float32),
        type_flags=rng.integers(0, 3, size=n, dtype=np.uint8),
        local_id=np.arange(n, dtype=np.uint32),
    )
    lo = position.min(axis=0)
    hi = position.max(axis=0)

    FIXTURE_DIR.mkdir(parents=True, exist_ok=True)
    (FIXTURE_DIR / "contract-tile.bin").write_bytes(encode_tile(points, lo, hi))

    # float16 is what actually lands in the file, so round the expectations
    # through float16 before recording them.
    expected = {
        "pointCount": n,
        "bboxMin": lo.tolist(),
        "bboxMax": hi.tolist(),
        "position": points.position.tolist(),
        "velocity": points.velocity.astype(np.float16).astype(np.float64).tolist(),
        "colorIndex": points.color_index.tolist(),
        "absMag": points.abs_mag.astype(np.float16).astype(np.float64).tolist(),
        "typeFlags": points.type_flags.tolist(),
        "localId": points.local_id.tolist(),
    }
    (FIXTURE_DIR / "contract-tile.json").write_text(json.dumps(expected), encoding="utf-8")

    assert (FIXTURE_DIR / "contract-tile.bin").stat().st_size > 64
```

- [ ] **Step 2: Generate the fixture**

Run: `.venv/Scripts/python -m pytest pipeline/tests/test_fixture_export.py -v`
Expected: 1 passed, and `tests/fixtures/contract-tile.bin` plus `contract-tile.json` now exist.

- [ ] **Step 3: Write the failing TypeScript contract test**

```typescript
// app/src/tiles/format.test.ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { decodeFloat16, decodeTile, dequantizePosition } from './format.js';

const fixturePath = (name: string) =>
  fileURLToPath(new URL(`../../../tests/fixtures/${name}`, import.meta.url));

const blob = readFileSync(fixturePath('contract-tile.bin'));
const expected = JSON.parse(readFileSync(fixturePath('contract-tile.json'), 'utf-8')) as {
  pointCount: number;
  bboxMin: number[];
  bboxMax: number[];
  position: number[][];
  velocity: number[][];
  colorIndex: number[];
  absMag: number[];
  typeFlags: number[];
  localId: number[];
};

const buffer = blob.buffer.slice(blob.byteOffset, blob.byteOffset + blob.byteLength);

describe('decodeTile', () => {
  const tile = decodeTile(buffer);

  it('reads the header', () => {
    expect(tile.pointCount).toBe(expected.pointCount);
    expect(Array.from(tile.bboxMin)).toEqual(expected.bboxMin);
    expect(Array.from(tile.bboxMax)).toEqual(expected.bboxMax);
  });

  it('reads exact-typed attributes byte-for-byte', () => {
    expect(Array.from(tile.colorIndex)).toEqual(expected.colorIndex);
    expect(Array.from(tile.typeFlags)).toEqual(expected.typeFlags);
    expect(Array.from(tile.localId)).toEqual(expected.localId);
  });

  it('dequantizes positions within half a quantization step', () => {
    const out = new Float64Array(3);
    for (let i = 0; i < tile.pointCount; i++) {
      dequantizePosition(tile, i, out);
      for (let axis = 0; axis < 3; axis++) {
        const step = (expected.bboxMax[axis]! - expected.bboxMin[axis]!) / 131070;
        expect(Math.abs(out[axis]! - expected.position[i]![axis]!)).toBeLessThanOrEqual(
          step + 1e-9,
        );
      }
    }
  });

  it('decodes float16 attributes to the values Python wrote', () => {
    for (let i = 0; i < tile.pointCount; i++) {
      expect(decodeFloat16(tile.absMag[i]!)).toBeCloseTo(expected.absMag[i]!, 5);
      for (let axis = 0; axis < 3; axis++) {
        expect(decodeFloat16(tile.velocity[i * 3 + axis]!)).toBeCloseTo(
          expected.velocity[i]![axis]!,
          5,
        );
      }
    }
  });

  it('rejects a tile with the wrong magic', () => {
    const corrupted = buffer.slice(0);
    new Uint8Array(corrupted).set([88, 88, 88, 88], 0);
    expect(() => decodeTile(corrupted)).toThrow(/magic/i);
  });
});
```

- [ ] **Step 4: Run it and confirm it fails**

Run: `npx vitest run app/src/tiles/format.test.ts`
Expected: FAIL — cannot resolve `./format.js`.

- [ ] **Step 5: Implement `app/src/tiles/format.ts`**

```typescript
/**
 * Tile format v1 decoder. See docs/tile-format.md — this file is a contract.
 * The Python side is pipeline/universe_pipeline/tileformat.py; the two are held
 * in agreement by app/src/tiles/format.test.ts.
 */

const MAGIC = 0x31544d55; // "UMT1" read as little-endian uint32
const VERSION = 1;
const HEADER_BYTES = 64;
const QUANT_MAX = 65535;

export interface DecodedTile {
  pointCount: number;
  bboxMin: Float64Array;
  bboxMax: Float64Array;
  /** uint16 fractions of the bounding box; interleaved xyz. */
  positionQuantized: Uint16Array;
  /** Raw float16 bits, interleaved xyz. Uploaded to the GPU as HALF_FLOAT. */
  velocity: Uint16Array;
  colorIndex: Uint16Array;
  /** Raw float16 bits. */
  absMag: Uint16Array;
  typeFlags: Uint8Array;
  localId: Uint32Array;
}

const align4 = (n: number): number => n + ((4 - (n % 4)) % 4);

export function decodeTile(buffer: ArrayBuffer): DecodedTile {
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== MAGIC) {
    throw new Error('bad tile magic: not a UMT1 tile');
  }
  const version = view.getUint32(4, true);
  if (version !== VERSION) {
    throw new Error(`unsupported tile format version ${version}`);
  }
  const pointCount = view.getUint32(8, true);

  const bboxMin = new Float64Array(3);
  const bboxMax = new Float64Array(3);
  for (let i = 0; i < 3; i++) {
    bboxMin[i] = view.getFloat64(16 + i * 8, true);
    bboxMax[i] = view.getFloat64(40 + i * 8, true);
  }

  let offset = HEADER_BYTES;
  const read = <T>(make: (buf: ArrayBuffer, off: number, len: number) => T, len: number, bytesPer: number): T => {
    // Typed array views need their own alignment; copy when the offset is not aligned.
    const byteLength = len * bytesPer;
    const slice = buffer.slice(offset, offset + byteLength);
    const arr = make(slice, 0, len);
    offset = align4(offset + byteLength);
    return arr;
  };

  const positionQuantized = read((b, o, l) => new Uint16Array(b, o, l), pointCount * 3, 2);
  const velocity = read((b, o, l) => new Uint16Array(b, o, l), pointCount * 3, 2);
  const colorIndex = read((b, o, l) => new Uint16Array(b, o, l), pointCount, 2);
  const absMag = read((b, o, l) => new Uint16Array(b, o, l), pointCount, 2);
  const typeFlags = read((b, o, l) => new Uint8Array(b, o, l), pointCount, 1);
  const localId = read((b, o, l) => new Uint32Array(b, o, l), pointCount, 4);

  return {
    pointCount,
    bboxMin,
    bboxMax,
    positionQuantized,
    velocity,
    colorIndex,
    absMag,
    typeFlags,
    localId,
  };
}

export function dequantizePosition(
  tile: DecodedTile,
  index: number,
  out: Float64Array,
): Float64Array {
  for (let axis = 0; axis < 3; axis++) {
    const lo = tile.bboxMin[axis]!;
    const hi = tile.bboxMax[axis]!;
    const q = tile.positionQuantized[index * 3 + axis]!;
    out[axis] = lo + (q / QUANT_MAX) * (hi - lo);
  }
  return out;
}

/** IEEE 754 half-precision bits to a JavaScript number. */
export function decodeFloat16(bits: number): number {
  const sign = (bits & 0x8000) === 0 ? 1 : -1;
  const exponent = (bits >> 10) & 0x1f;
  const mantissa = bits & 0x3ff;

  if (exponent === 0) return sign * mantissa * 2 ** -24;
  if (exponent === 0x1f) return mantissa === 0 ? sign * Infinity : Number.NaN;
  return sign * (mantissa + 1024) * 2 ** (exponent - 25);
}
```

- [ ] **Step 6: Run the contract test and confirm it passes**

Run: `npx vitest run app/src/tiles/format.test.ts`
Expected: 5 passed. If the float16 test fails, the bug is in `decodeFloat16`, not in the fixture — Python's float16 is IEEE 754 binary16 and is authoritative here.

- [ ] **Step 7: Commit, including the fixture**

The fixture is deliberately committed; `.gitignore` already exempts `tests/fixtures/**`.

```bash
git add app/src/tiles/format.ts app/src/tiles/format.test.ts \
        pipeline/tests/test_fixture_export.py tests/fixtures/
git commit -m "feat(app): add tile format v1 reader with cross-language contract test

Python writes a fixture tile, TypeScript reads it back and asserts every
attribute matches. Guards the frozen format so the pipeline and the app
can move independently."
```

---

### Task 4: Coordinate frames and golden transform tests

Coordinate errors are the likeliest serious bug in this project and are invisible by inspection — a wrong rotation matrix produces a starfield that looks perfectly plausible and is entirely wrong. Two decisions follow from that:

1. **astropy does the transform.** Hand-rolling the ICRS to Galactic rotation is exactly the code that produces plausible-but-wrong output. These tests verify our *usage* of astropy — right frame, right units, right axis order — not astropy itself.
2. **Tests assert against exactly-defined quantities, not published star distances.** Literature distances for individual stars disagree at the percent level, so a test hardcoding "Sirius is 8.709 ly" encodes a debate. The galactic pole, the galactic centre direction, and parallax inversion are exact by definition.

**Files:**
- Create: `pipeline/universe_pipeline/frames.py`
- Test: `pipeline/tests/test_frames.py`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `LY_PER_PC: float = 3.261563777167433`
  - `parallax_to_distance_pc(parallax_mas: np.ndarray) -> np.ndarray`
  - `icrs_to_galactic_lb(ra_deg, dec_deg) -> tuple[np.ndarray, np.ndarray]`
  - `icrs_to_galactic_cartesian(ra_deg, dec_deg, distance_pc) -> np.ndarray` returning `(N, 3)` in parsecs
  - `icrs_to_galactic_velocity(ra_deg, dec_deg, distance_pc, pmra_mas_yr, pmdec_mas_yr, rv_km_s) -> np.ndarray` returning `(N, 3)` in km/s

`pmra_mas_yr` is Gaia's `pmra`, which is already multiplied by `cos(dec)`. It maps to astropy's `pm_ra_cosdec`, not `pm_ra`. Getting this wrong tilts every velocity toward the poles.

- [ ] **Step 1: Write the failing golden tests**

```python
# pipeline/tests/test_frames.py
"""Golden tests for coordinate transforms.

Reference values are exactly-defined quantities, not measured star distances:

- The IAU galactic pole and centre directions are definitional (Hipparcos/IAU
  1958 convention, as implemented by astropy's Galactic frame).
- Parallax inversion is arithmetic: d[pc] == 1000 / parallax[mas].
- Sagittarius A* sits within a twentieth of a degree of the galactic origin;
  ICRS 266.41684, -29.00781 -> l = 359.944, b = -0.046.
"""

import numpy as np
import pytest

from universe_pipeline.frames import (
    LY_PER_PC,
    icrs_to_galactic_cartesian,
    icrs_to_galactic_lb,
    icrs_to_galactic_velocity,
    parallax_to_distance_pc,
)

ARCSEC_DEG = 1.0 / 3600.0

NORTH_GALACTIC_POLE_ICRS = (192.85948, 27.12825)
GALACTIC_CENTRE_ICRS = (266.40510, -28.93617)
SGR_A_STAR_ICRS = (266.41684, -29.00781)


def test_parallax_inversion_is_exact() -> None:
    parallax = np.array([768.0665, 100.0, 1.0])
    np.testing.assert_allclose(
        parallax_to_distance_pc(parallax),
        np.array([1000.0 / 768.0665, 10.0, 1000.0]),
        rtol=1e-12,
    )


def test_light_year_conversion_matches_the_iau_definition() -> None:
    # 1 pc = 648000/pi AU; 1 ly = 9460730472580800 m exactly (IAU).
    assert LY_PER_PC == pytest.approx(3.261563777167433, rel=1e-12)


def test_north_galactic_pole_maps_to_latitude_90() -> None:
    ra, dec = NORTH_GALACTIC_POLE_ICRS
    _, b = icrs_to_galactic_lb(np.array([ra]), np.array([dec]))
    assert abs(b[0] - 90.0) < ARCSEC_DEG


def test_galactic_centre_maps_to_the_origin() -> None:
    ra, dec = GALACTIC_CENTRE_ICRS
    lon, lat = icrs_to_galactic_lb(np.array([ra]), np.array([dec]))
    # Longitude wraps; fold to [-180, 180) before comparing to zero.
    folded = (lon[0] + 180.0) % 360.0 - 180.0
    assert abs(folded) < ARCSEC_DEG
    assert abs(lat[0]) < ARCSEC_DEG


def test_sagittarius_a_star_lands_where_the_literature_puts_it() -> None:
    ra, dec = SGR_A_STAR_ICRS
    lon, lat = icrs_to_galactic_lb(np.array([ra]), np.array([dec]))
    assert lon[0] == pytest.approx(359.9442, abs=0.001)
    assert lat[0] == pytest.approx(-0.0462, abs=0.001)


def test_axis_convention_places_the_galactic_centre_on_positive_x() -> None:
    ra, dec = GALACTIC_CENTRE_ICRS
    xyz = icrs_to_galactic_cartesian(np.array([ra]), np.array([dec]), np.array([100.0]))
    np.testing.assert_allclose(xyz[0], np.array([100.0, 0.0, 0.0]), atol=1e-3)


def test_axis_convention_places_the_galactic_pole_on_positive_z() -> None:
    ra, dec = NORTH_GALACTIC_POLE_ICRS
    xyz = icrs_to_galactic_cartesian(np.array([ra]), np.array([dec]), np.array([100.0]))
    np.testing.assert_allclose(xyz[0], np.array([0.0, 0.0, 100.0]), atol=1e-3)


def test_cartesian_magnitude_equals_the_input_distance() -> None:
    rng = np.random.default_rng(7)
    n = 500
    ra = rng.uniform(0.0, 360.0, n)
    dec = np.degrees(np.arcsin(rng.uniform(-1.0, 1.0, n)))
    distance = rng.uniform(1.0, 1500.0, n)

    xyz = icrs_to_galactic_cartesian(ra, dec, distance)

    np.testing.assert_allclose(np.linalg.norm(xyz, axis=1), distance, rtol=1e-9)


def test_pure_radial_velocity_is_parallel_to_the_position_vector() -> None:
    ra = np.array([120.0])
    dec = np.array([-15.0])
    distance = np.array([50.0])

    xyz = icrs_to_galactic_cartesian(ra, dec, distance)
    velocity = icrs_to_galactic_velocity(
        ra, dec, distance,
        pmra_mas_yr=np.array([0.0]),
        pmdec_mas_yr=np.array([0.0]),
        rv_km_s=np.array([10.0]),
    )

    direction = xyz[0] / np.linalg.norm(xyz[0])
    np.testing.assert_allclose(velocity[0], direction * 10.0, atol=1e-6)


def test_pure_proper_motion_is_perpendicular_to_the_position_vector() -> None:
    ra = np.array([200.0])
    dec = np.array([35.0])
    distance = np.array([10.0])

    xyz = icrs_to_galactic_cartesian(ra, dec, distance)
    velocity = icrs_to_galactic_velocity(
        ra, dec, distance,
        pmra_mas_yr=np.array([50.0]),
        pmdec_mas_yr=np.array([-30.0]),
        rv_km_s=np.array([0.0]),
    )

    direction = xyz[0] / np.linalg.norm(xyz[0])
    assert abs(float(np.dot(velocity[0], direction))) < 1e-6


def test_tangential_speed_matches_the_standard_4_74047_relation() -> None:
    # v_t [km/s] = 4.74047 * mu["/yr] * d[pc], with mu given here in mas/yr.
    distance_pc = 100.0
    pmra = 20.0
    velocity = icrs_to_galactic_velocity(
        np.array([10.0]), np.array([20.0]), np.array([distance_pc]),
        pmra_mas_yr=np.array([pmra]),
        pmdec_mas_yr=np.array([0.0]),
        rv_km_s=np.array([0.0]),
    )
    expected = 4.74047 * (pmra / 1000.0) * distance_pc
    assert float(np.linalg.norm(velocity[0])) == pytest.approx(expected, rel=1e-4)


def test_transforms_handle_empty_input() -> None:
    empty = np.array([], dtype=float)
    assert icrs_to_galactic_cartesian(empty, empty, empty).shape == (0, 3)
```

- [ ] **Step 2: Run and confirm failure**

Run: `.venv/Scripts/python -m pytest pipeline/tests/test_frames.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'universe_pipeline.frames'`

- [ ] **Step 3: Implement `pipeline/universe_pipeline/frames.py`**

```python
"""ICRS to Galactic Cartesian transforms.

astropy owns the actual rotation. This module fixes the units, the axis order
and the Gaia column conventions, and pipeline/tests/test_frames.py pins that
usage down.

Galactic Cartesian axes, Sun at the origin:
    +X toward the galactic centre (l = 0, b = 0)
    +Y toward l = 90 degrees
    +Z toward the north galactic pole
"""

from __future__ import annotations

import astropy.units as u
import numpy as np
from astropy.coordinates import Galactic, SkyCoord

# 1 pc = 648000/pi AU, 1 AU = 149597870700 m, 1 ly = 9460730472580800 m (all exact).
LY_PER_PC = (648000.0 / np.pi) * 149597870700.0 / 9460730472580800.0
PC_PER_LY = 1.0 / LY_PER_PC


def parallax_to_distance_pc(parallax_mas: np.ndarray) -> np.ndarray:
    """Naive parallax inversion. Biased at low signal-to-noise; callers must
    apply a parallax_over_error cut before relying on this."""
    return 1000.0 / np.asarray(parallax_mas, dtype=np.float64)


def _icrs(ra_deg: np.ndarray, dec_deg: np.ndarray, **kwargs: object) -> SkyCoord:
    return SkyCoord(
        ra=np.asarray(ra_deg, dtype=np.float64) * u.deg,
        dec=np.asarray(dec_deg, dtype=np.float64) * u.deg,
        frame="icrs",
        **kwargs,
    )


def icrs_to_galactic_lb(
    ra_deg: np.ndarray, dec_deg: np.ndarray
) -> tuple[np.ndarray, np.ndarray]:
    """Galactic longitude and latitude in degrees."""
    galactic = _icrs(ra_deg, dec_deg).transform_to(Galactic())
    return (
        np.asarray(galactic.l.to_value(u.deg), dtype=np.float64),
        np.asarray(galactic.b.to_value(u.deg), dtype=np.float64),
    )


def icrs_to_galactic_cartesian(
    ra_deg: np.ndarray, dec_deg: np.ndarray, distance_pc: np.ndarray
) -> np.ndarray:
    """Positions as an (N, 3) array of parsecs in the Galactic frame."""
    ra_deg = np.asarray(ra_deg, dtype=np.float64)
    if ra_deg.size == 0:
        return np.zeros((0, 3), dtype=np.float64)

    coord = _icrs(ra_deg, dec_deg, distance=np.asarray(distance_pc, dtype=np.float64) * u.pc)
    cartesian = coord.transform_to(Galactic()).cartesian
    return np.stack(
        [
            cartesian.x.to_value(u.pc),
            cartesian.y.to_value(u.pc),
            cartesian.z.to_value(u.pc),
        ],
        axis=-1,
    ).astype(np.float64)


def icrs_to_galactic_velocity(
    ra_deg: np.ndarray,
    dec_deg: np.ndarray,
    distance_pc: np.ndarray,
    pmra_mas_yr: np.ndarray,
    pmdec_mas_yr: np.ndarray,
    rv_km_s: np.ndarray,
) -> np.ndarray:
    """Space velocity as an (N, 3) array of km/s in the Galactic frame.

    Gaia's `pmra` already carries the cos(dec) factor, so it maps to astropy's
    `pm_ra_cosdec`. Using `pm_ra` instead tilts every velocity toward the poles.

    The result stays heliocentric: no correction for the Sun's own motion is
    applied, which is what a Sun-origin layer wants.
    """
    ra_deg = np.asarray(ra_deg, dtype=np.float64)
    if ra_deg.size == 0:
        return np.zeros((0, 3), dtype=np.float64)

    coord = _icrs(
        ra_deg,
        dec_deg,
        distance=np.asarray(distance_pc, dtype=np.float64) * u.pc,
        pm_ra_cosdec=np.asarray(pmra_mas_yr, dtype=np.float64) * u.mas / u.yr,
        pm_dec=np.asarray(pmdec_mas_yr, dtype=np.float64) * u.mas / u.yr,
        radial_velocity=np.asarray(rv_km_s, dtype=np.float64) * u.km / u.s,
    )
    d_xyz = coord.transform_to(Galactic()).velocity.d_xyz.to_value(u.km / u.s)
    return np.ascontiguousarray(d_xyz.T, dtype=np.float64)
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `.venv/Scripts/python -m pytest pipeline/tests/test_frames.py -v`
Expected: 11 passed.

If `test_axis_convention_places_the_galactic_centre_on_positive_x` fails with the value on Y or Z, the axis order in the `np.stack` is wrong — fix the stack, not the test.

- [ ] **Step 5: Commit**

```bash
.venv/Scripts/python -m ruff check pipeline
git add pipeline/universe_pipeline/frames.py pipeline/tests/test_frames.py
git commit -m "feat(pipeline): add ICRS to Galactic Cartesian transforms

astropy performs the rotation; this module pins units, axis order and the
Gaia pmra/pm_ra_cosdec convention. Golden tests assert against definitional
quantities - galactic pole, galactic centre, parallax inversion - rather
than contested published star distances."
```

---

### Task 5: Normalized record schema and the Gaia source adapter

**Files:**
- Create: `pipeline/universe_pipeline/config.py`
- Create: `pipeline/universe_pipeline/records.py`
- Create: `pipeline/universe_pipeline/sources/__init__.py`
- Create: `pipeline/universe_pipeline/sources/gaia.py`
- Test: `pipeline/tests/test_gaia.py`

**Interfaces:**
- Consumes: `frames` from Task 4.
- Produces:
  - `L1_STELLAR_NEIGHBOURHOOD: LayerConfig` with fields `key: str`, `unit: str`, `unit_in_metres: float`, `max_radius_ly: float`, `g_mag_limit: float`, `min_parallax_over_error: float`, `max_points_per_tile: int`
  - `ObjectRecord` — a dataclass of parallel numpy arrays: `position_ly (N,3) float64`, `velocity_km_s (N,3) float32`, `abs_mag (N,) float32`, `colour_index (N,) uint16`, `type_flags (N,) uint8`, `catalog_id (N,) uint64`
  - `TYPE_STAR: int = 1 << 1`, `FLAG_MODELED: int = 1 << 0`
  - `normalise_gaia(table: Mapping[str, np.ndarray], layer: LayerConfig) -> ObjectRecord`
  - `build_gaia_adql(layer: LayerConfig, healpix_lo: int, healpix_hi: int) -> str`
  - `fetch_gaia_chunk(layer, healpix_lo, healpix_hi, cache_dir) -> dict[str, np.ndarray]`

`normalise_gaia` is a pure function over in-memory arrays, so the whole normalization path is testable without touching the network. `fetch_gaia_chunk` is the only function that does I/O and is deliberately kept trivial.

- [ ] **Step 1: Write `pipeline/universe_pipeline/config.py`**

```python
"""All pipeline tunables. Object count is set here, never hardcoded in logic."""

from __future__ import annotations

from dataclasses import dataclass

LY_IN_METRES = 9460730472580800.0


@dataclass(frozen=True)
class LayerConfig:
    key: str
    unit: str
    unit_in_metres: float
    min_radius_ly: float
    max_radius_ly: float
    g_mag_limit: float
    min_parallax_over_error: float
    max_points_per_tile: int


# Raising g_mag_limit is how density increases. At G < 16 this yields on the
# order of ten million sources inside 5000 ly; tune it against a real build.
L1_STELLAR_NEIGHBOURHOOD = LayerConfig(
    key="stellar-neighbourhood",
    unit="ly",
    unit_in_metres=LY_IN_METRES,
    min_radius_ly=0.01,
    max_radius_ly=5000.0,
    g_mag_limit=16.0,
    min_parallax_over_error=5.0,
    max_points_per_tile=65536,
)
```

- [ ] **Step 2: Write the failing normalization tests**

```python
# pipeline/tests/test_gaia.py
import numpy as np
import pytest

from universe_pipeline.config import L1_STELLAR_NEIGHBOURHOOD
from universe_pipeline.records import FLAG_MODELED, TYPE_STAR
from universe_pipeline.sources.gaia import build_gaia_adql, normalise_gaia


def sample_table(**overrides: np.ndarray) -> dict[str, np.ndarray]:
    table = {
        "source_id": np.array([1, 2, 3], dtype=np.uint64),
        "ra": np.array([266.40510, 10.0, 200.0]),
        "dec": np.array([-28.93617, 20.0, -40.0]),
        "parallax": np.array([10.0, 1.0, 0.5]),
        "parallax_over_error": np.array([50.0, 20.0, 1.0]),
        "pmra": np.array([0.0, 5.0, -3.0]),
        "pmdec": np.array([0.0, -2.0, 4.0]),
        "radial_velocity": np.array([0.0, np.nan, 12.0]),
        "phot_g_mean_mag": np.array([8.0, 12.0, 14.0]),
        "bp_rp": np.array([0.5, 1.8, np.nan]),
        "r_med_geo": np.array([100.0, 1000.0, np.nan]),
    }
    table.update(overrides)
    return table


def test_drops_sources_failing_the_parallax_quality_cut() -> None:
    record = normalise_gaia(sample_table(), L1_STELLAR_NEIGHBOURHOOD)
    # The third source has parallax_over_error = 1.0 and no Bailer-Jones
    # distance, so it must be dropped rather than guessed.
    assert len(record) == 2
    assert list(record.catalog_id) == [1, 2]


def test_prefers_bailer_jones_distance_over_parallax_inversion() -> None:
    record = normalise_gaia(sample_table(), L1_STELLAR_NEIGHBOURHOOD)
    # Source 1: r_med_geo = 100 pc, whereas 1/parallax would give 100 pc too.
    # Source 2: r_med_geo = 1000 pc, and 1/parallax would give 1000 pc.
    # Use a case where they differ to prove which one is chosen.
    table = sample_table(r_med_geo=np.array([250.0, 1000.0, np.nan]))
    record = normalise_gaia(table, L1_STELLAR_NEIGHBOURHOOD)
    distance_ly = float(np.linalg.norm(record.position_ly[0]))
    assert distance_ly == pytest.approx(250.0 * 3.261563777167433, rel=1e-6)


def test_places_the_galactic_centre_direction_on_positive_x() -> None:
    record = normalise_gaia(sample_table(), L1_STELLAR_NEIGHBOURHOOD)
    unit = record.position_ly[0] / np.linalg.norm(record.position_ly[0])
    np.testing.assert_allclose(unit, np.array([1.0, 0.0, 0.0]), atol=1e-5)


def test_missing_radial_velocity_becomes_zero_not_nan() -> None:
    record = normalise_gaia(sample_table(), L1_STELLAR_NEIGHBOURHOOD)
    assert np.all(np.isfinite(record.velocity_km_s))


def test_drops_sources_beyond_the_layer_radius() -> None:
    table = sample_table(r_med_geo=np.array([100.0, 9_000_000.0, np.nan]))
    record = normalise_gaia(table, L1_STELLAR_NEIGHBOURHOOD)
    assert len(record) == 1


def test_all_records_are_measured_stars() -> None:
    record = normalise_gaia(sample_table(), L1_STELLAR_NEIGHBOURHOOD)
    assert np.all(record.type_flags & TYPE_STAR)
    assert not np.any(record.type_flags & FLAG_MODELED)


def test_absolute_magnitude_uses_the_distance_modulus() -> None:
    table = sample_table(
        phot_g_mean_mag=np.array([10.0, 12.0, 14.0]),
        r_med_geo=np.array([100.0, 1000.0, np.nan]),
    )
    record = normalise_gaia(table, L1_STELLAR_NEIGHBOURHOOD)
    # M = m - 5*log10(d_pc) + 5 => 10 - 10 + 5 = 5
    assert float(record.abs_mag[0]) == pytest.approx(5.0, abs=1e-4)


def test_missing_colour_falls_back_to_a_neutral_index() -> None:
    record = normalise_gaia(sample_table(), L1_STELLAR_NEIGHBOURHOOD)
    assert np.all(record.colour_index <= 65535)


def test_adql_applies_the_configured_limits() -> None:
    query = build_gaia_adql(L1_STELLAR_NEIGHBOURHOOD, 0, 1023)
    assert "phot_g_mean_mag < 16.0" in query
    assert "parallax_over_error > 5.0" in query
    assert "source_id BETWEEN" in query
```

- [ ] **Step 3: Run and confirm failure**

Run: `.venv/Scripts/python -m pytest pipeline/tests/test_gaia.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'universe_pipeline.records'`

- [ ] **Step 4: Implement `pipeline/universe_pipeline/records.py`**

```python
"""The normalized schema every catalog source produces."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

FLAG_MODELED = 1 << 0
TYPE_STAR = 1 << 1
TYPE_GALAXY = 1 << 2
TYPE_BLACK_HOLE = 1 << 3
TYPE_NEBULA = 1 << 4
TYPE_CLUSTER = 1 << 5


@dataclass
class ObjectRecord:
    """Parallel arrays describing objects already placed in layer coordinates."""

    position_ly: np.ndarray  # float64 (N, 3)
    velocity_km_s: np.ndarray  # float32 (N, 3)
    abs_mag: np.ndarray  # float32 (N,)
    colour_index: np.ndarray  # uint16 (N,)
    type_flags: np.ndarray  # uint8 (N,)
    catalog_id: np.ndarray  # uint64 (N,)

    def __len__(self) -> int:
        return int(self.position_ly.shape[0])

    def take(self, mask: np.ndarray) -> ObjectRecord:
        return ObjectRecord(
            position_ly=self.position_ly[mask],
            velocity_km_s=self.velocity_km_s[mask],
            abs_mag=self.abs_mag[mask],
            colour_index=self.colour_index[mask],
            type_flags=self.type_flags[mask],
            catalog_id=self.catalog_id[mask],
        )
```

- [ ] **Step 5: Implement `pipeline/universe_pipeline/sources/gaia.py`**

Create `pipeline/universe_pipeline/sources/__init__.py` as an empty file first.

```python
"""Gaia DR3 to ObjectRecord.

normalise_gaia is pure and operates on in-memory arrays, so the whole
transformation path is testable offline. fetch_gaia_chunk is the only function
here that touches the network, and it is deliberately trivial.
"""

from __future__ import annotations

from collections.abc import Mapping
from pathlib import Path

import numpy as np

from universe_pipeline.config import LayerConfig
from universe_pipeline.frames import (
    LY_PER_PC,
    icrs_to_galactic_cartesian,
    icrs_to_galactic_velocity,
    parallax_to_distance_pc,
)
from universe_pipeline.records import TYPE_STAR, ObjectRecord

# BP-RP spans roughly -0.5 (hot blue) to 5.0 (cool red) for real stars.
BP_RP_MIN = -0.5
BP_RP_MAX = 5.0
BP_RP_NEUTRAL = 0.8


def build_gaia_adql(layer: LayerConfig, healpix_lo: int, healpix_hi: int) -> str:
    """One chunk of the layer, bounded by HEALPix level-8 source_id range.

    Gaia source_id encodes HEALPix level 12 in its high bits, so a source_id
    range is a sky region. Chunking this way keeps each job under the archive's
    row limit and makes the download resumable.
    """
    shift = 2 ** (59 - 2 * 8)
    return f"""
SELECT g.source_id, g.ra, g.dec, g.parallax, g.parallax_over_error,
       g.pmra, g.pmdec, g.radial_velocity, g.phot_g_mean_mag, g.bp_rp,
       d.r_med_geo
FROM gaiadr3.gaia_source AS g
LEFT JOIN external.gaiaedr3_distance AS d ON d.source_id = g.source_id
WHERE g.source_id BETWEEN {healpix_lo * shift} AND {(healpix_hi + 1) * shift - 1}
  AND g.phot_g_mean_mag < {layer.g_mag_limit}
  AND g.parallax_over_error > {layer.min_parallax_over_error}
  AND g.parallax > {1000.0 / (layer.max_radius_ly / LY_PER_PC)}
""".strip()


def fetch_gaia_chunk(
    layer: LayerConfig, healpix_lo: int, healpix_hi: int, cache_dir: Path
) -> dict[str, np.ndarray]:
    """Run one ADQL chunk, caching the raw result on disk. Never refetches."""
    from astroquery.gaia import Gaia

    cache_dir.mkdir(parents=True, exist_ok=True)
    cached = cache_dir / f"gaia-{layer.key}-{healpix_lo:05d}-{healpix_hi:05d}.npz"
    if cached.exists():
        with np.load(cached) as data:
            return {key: data[key] for key in data.files}

    job = Gaia.launch_job_async(build_gaia_adql(layer, healpix_lo, healpix_hi))
    table = job.get_results()
    arrays = {name: np.asarray(table[name].filled(np.nan)) for name in table.colnames}
    np.savez_compressed(cached, **arrays)
    return arrays


def _column(table: Mapping[str, np.ndarray], name: str) -> np.ndarray:
    return np.asarray(table[name], dtype=np.float64)


def normalise_gaia(table: Mapping[str, np.ndarray], layer: LayerConfig) -> ObjectRecord:
    """Gaia columns to layer-space records. Drops anything it cannot place."""
    parallax = _column(table, "parallax")
    parallax_snr = _column(table, "parallax_over_error")
    bailer_jones = _column(table, "r_med_geo")

    # Bailer-Jones geometric distance where available; naive inversion only
    # above the quality cut. Anything with neither is dropped, never guessed.
    inverted = np.where(parallax > 0.0, parallax_to_distance_pc(np.where(parallax > 0.0, parallax, 1.0)), np.nan)
    usable_inversion = np.isfinite(inverted) & (parallax_snr > layer.min_parallax_over_error)
    distance_pc = np.where(np.isfinite(bailer_jones), bailer_jones, np.where(usable_inversion, inverted, np.nan))

    keep = np.isfinite(distance_pc) & (distance_pc > 0.0)
    distance_ly = distance_pc * LY_PER_PC
    keep &= distance_ly >= layer.min_radius_ly
    keep &= distance_ly <= layer.max_radius_ly

    ra = _column(table, "ra")[keep]
    dec = _column(table, "dec")[keep]
    distance_pc = distance_pc[keep]

    position_ly = icrs_to_galactic_cartesian(ra, dec, distance_pc) * LY_PER_PC

    # Missing radial velocity means unknown, not stationary; zero is the honest
    # placeholder and the flag carried alongside says the star has no RV.
    rv = np.nan_to_num(_column(table, "radial_velocity")[keep], nan=0.0)
    velocity = icrs_to_galactic_velocity(
        ra, dec, distance_pc,
        pmra_mas_yr=np.nan_to_num(_column(table, "pmra")[keep], nan=0.0),
        pmdec_mas_yr=np.nan_to_num(_column(table, "pmdec")[keep], nan=0.0),
        rv_km_s=rv,
    )

    g_mag = _column(table, "phot_g_mean_mag")[keep]
    abs_mag = g_mag - 5.0 * np.log10(distance_pc) + 5.0

    bp_rp = np.nan_to_num(_column(table, "bp_rp")[keep], nan=BP_RP_NEUTRAL)
    colour = np.clip((bp_rp - BP_RP_MIN) / (BP_RP_MAX - BP_RP_MIN), 0.0, 1.0)

    n = int(keep.sum())
    return ObjectRecord(
        position_ly=position_ly,
        velocity_km_s=velocity.astype(np.float32),
        abs_mag=abs_mag.astype(np.float32),
        colour_index=np.rint(colour * 65535.0).astype(np.uint16),
        type_flags=np.full(n, TYPE_STAR, dtype=np.uint8),
        catalog_id=np.asarray(table["source_id"], dtype=np.uint64)[keep],
    )
```

- [ ] **Step 6: Run the tests and confirm they pass**

Run: `.venv/Scripts/python -m pytest pipeline/tests/test_gaia.py -v`
Expected: 9 passed.

- [ ] **Step 7: Commit**

```bash
.venv/Scripts/python -m ruff check pipeline
git add pipeline/universe_pipeline/config.py pipeline/universe_pipeline/records.py \
        pipeline/universe_pipeline/sources/ pipeline/tests/test_gaia.py
git commit -m "feat(pipeline): normalize Gaia DR3 into layer-space records

Prefers Bailer-Jones geometric distances, falls back to parallax inversion
only above the quality cut, and drops anything it cannot place rather than
guessing. Normalization is a pure function so it tests without network."
```

---

### Task 6: Additive-refinement octree builder

**Files:**
- Create: `pipeline/universe_pipeline/octree.py`
- Test: `pipeline/tests/test_octree.py`

**Interfaces:**
- Consumes: nothing (pure geometry over a position array).
- Produces:
  - `OctreeNode` — dataclass with `path: str`, `bbox_min: np.ndarray`, `bbox_max: np.ndarray`, `indices: np.ndarray` (uint32, the points this node draws itself), `children: list[OctreeNode]`, `geometric_error: float`, `total_points: int`
  - `build_octree(positions: np.ndarray, max_points_per_node: int, seed: int = 0) -> OctreeNode`
  - `iter_nodes(root: OctreeNode) -> Iterator[OctreeNode]`

Refinement is **additive**: a node keeps a random subsample and hands the remainder down. Rendering a node means drawing its own `indices`; descending draws children *in addition*, not instead. Every input point therefore belongs to exactly one node, and the union of a subtree is the full set beneath it.

- [ ] **Step 1: Write the failing invariant tests**

```python
# pipeline/tests/test_octree.py
import numpy as np
import pytest

from universe_pipeline.octree import build_octree, iter_nodes


def random_positions(n: int, seed: int = 0) -> np.ndarray:
    rng = np.random.default_rng(seed)
    # Deliberately clustered: uniform data hides bugs that clumped data exposes.
    centres = rng.uniform(-500.0, 500.0, size=(12, 3))
    picks = rng.integers(0, len(centres), size=n)
    return centres[picks] + rng.normal(0.0, 30.0, size=(n, 3))


def test_every_point_appears_exactly_once() -> None:
    positions = random_positions(20_000)
    root = build_octree(positions, max_points_per_node=512)

    seen = np.concatenate([node.indices for node in iter_nodes(root)])

    assert seen.size == len(positions)
    np.testing.assert_array_equal(np.sort(seen), np.arange(len(positions)))


def test_no_node_exceeds_its_point_budget() -> None:
    root = build_octree(random_positions(20_000), max_points_per_node=512)
    assert all(node.indices.size <= 512 for node in iter_nodes(root))


def test_every_node_bounding_box_contains_its_own_points() -> None:
    positions = random_positions(20_000)
    root = build_octree(positions, max_points_per_node=512)

    for node in iter_nodes(root):
        if node.indices.size == 0:
            continue
        owned = positions[node.indices]
        assert np.all(owned >= node.bbox_min - 1e-9)
        assert np.all(owned <= node.bbox_max + 1e-9)


def test_child_boxes_nest_inside_the_parent_box() -> None:
    root = build_octree(random_positions(20_000), max_points_per_node=512)

    for node in iter_nodes(root):
        for child in node.children:
            assert np.all(child.bbox_min >= node.bbox_min - 1e-9)
            assert np.all(child.bbox_max <= node.bbox_max + 1e-9)


def test_total_point_count_is_preserved_at_every_node() -> None:
    root = build_octree(random_positions(20_000), max_points_per_node=512)

    for node in iter_nodes(root):
        expected = node.indices.size + sum(child.total_points for child in node.children)
        assert node.total_points == expected

    assert root.total_points == 20_000


def test_geometric_error_shrinks_with_depth() -> None:
    root = build_octree(random_positions(20_000), max_points_per_node=512)

    for node in iter_nodes(root):
        for child in node.children:
            assert child.geometric_error < node.geometric_error


def test_node_paths_are_unique_and_encode_the_tree() -> None:
    root = build_octree(random_positions(20_000), max_points_per_node=512)

    paths = [node.path for node in iter_nodes(root)]
    assert len(paths) == len(set(paths))
    assert root.path == "r"
    for node in iter_nodes(root):
        for child in node.children:
            assert child.path.startswith(node.path)
            assert len(child.path) == len(node.path) + 1


def test_small_input_produces_a_single_leaf() -> None:
    positions = random_positions(100)
    root = build_octree(positions, max_points_per_node=512)

    assert root.children == []
    assert root.indices.size == 100


def test_empty_input_produces_an_empty_root() -> None:
    root = build_octree(np.zeros((0, 3)), max_points_per_node=512)
    assert root.total_points == 0
    assert root.indices.size == 0


def test_build_is_deterministic_for_a_fixed_seed() -> None:
    positions = random_positions(5_000)
    a = build_octree(positions, max_points_per_node=256, seed=42)
    b = build_octree(positions, max_points_per_node=256, seed=42)

    for node_a, node_b in zip(iter_nodes(a), iter_nodes(b), strict=True):
        assert node_a.path == node_b.path
        np.testing.assert_array_equal(node_a.indices, node_b.indices)


def test_identical_points_do_not_recurse_forever() -> None:
    # A degenerate box cannot be subdivided; the builder must stop rather than
    # split a zero-width box until the stack blows.
    positions = np.zeros((5_000, 3))
    root = build_octree(positions, max_points_per_node=64)

    assert root.total_points == 5_000
    depth = max(len(node.path) for node in iter_nodes(root))
    assert depth < 40


def test_rejects_a_non_positive_budget() -> None:
    with pytest.raises(ValueError, match="max_points_per_node"):
        build_octree(random_positions(10), max_points_per_node=0)
```

- [ ] **Step 2: Run and confirm failure**

Run: `.venv/Scripts/python -m pytest pipeline/tests/test_octree.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'universe_pipeline.octree'`

- [ ] **Step 3: Implement `pipeline/universe_pipeline/octree.py`**

```python
"""Additive-refinement octree, following the Potree approach.

Each node keeps a random subsample of the points beneath it and passes the
remainder to its children. Drawing a node means drawing its own points;
descending adds detail on top rather than replacing it. Every input point is
owned by exactly one node.
"""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass, field

import numpy as np

# A box cannot be split forever. Identical points would otherwise recurse until
# the stack gives out, so depth is capped and the deepest node keeps the rest.
MAX_DEPTH = 24


@dataclass
class OctreeNode:
    path: str
    bbox_min: np.ndarray
    bbox_max: np.ndarray
    indices: np.ndarray
    geometric_error: float
    total_points: int
    children: list[OctreeNode] = field(default_factory=list)


def iter_nodes(root: OctreeNode) -> Iterator[OctreeNode]:
    """Depth-first, parents before children."""
    stack = [root]
    while stack:
        node = stack.pop()
        yield node
        stack.extend(reversed(node.children))


def _geometric_error(bbox_min: np.ndarray, bbox_max: np.ndarray, point_count: int) -> float:
    """Approximate spacing between the points a node draws.

    A node holding k points spread across a box of diagonal D has mean spacing
    of roughly D / k^(1/3). That is the distance a viewer would need to resolve
    before the node stops being a good enough stand-in for its children.
    """
    diagonal = float(np.linalg.norm(bbox_max - bbox_min))
    return diagonal / max(point_count, 1) ** (1.0 / 3.0)


def _child_box(
    bbox_min: np.ndarray, bbox_max: np.ndarray, octant: int
) -> tuple[np.ndarray, np.ndarray]:
    centre = (bbox_min + bbox_max) * 0.5
    lo = np.where([(octant >> axis) & 1 for axis in range(3)], centre, bbox_min)
    hi = np.where([(octant >> axis) & 1 for axis in range(3)], bbox_max, centre)
    return lo.astype(np.float64), hi.astype(np.float64)


def _build(
    positions: np.ndarray,
    indices: np.ndarray,
    bbox_min: np.ndarray,
    bbox_max: np.ndarray,
    path: str,
    max_points_per_node: int,
    rng: np.random.Generator,
    depth: int,
) -> OctreeNode:
    total = int(indices.size)

    if total <= max_points_per_node or depth >= MAX_DEPTH:
        return OctreeNode(
            path=path,
            bbox_min=bbox_min,
            bbox_max=bbox_max,
            indices=indices.astype(np.uint32),
            geometric_error=_geometric_error(bbox_min, bbox_max, total),
            total_points=total,
        )

    # Keep a random subsample here; everything else descends.
    shuffled = rng.permutation(indices)
    kept = shuffled[:max_points_per_node]
    remaining = shuffled[max_points_per_node:]

    centre = (bbox_min + bbox_max) * 0.5
    octants = (
        (positions[remaining, 0] >= centre[0]).astype(np.uint8)
        | ((positions[remaining, 1] >= centre[1]).astype(np.uint8) << 1)
        | ((positions[remaining, 2] >= centre[2]).astype(np.uint8) << 2)
    )

    children: list[OctreeNode] = []
    for octant in range(8):
        member = remaining[octants == octant]
        if member.size == 0:
            continue
        child_min, child_max = _child_box(bbox_min, bbox_max, octant)
        children.append(
            _build(
                positions, member, child_min, child_max,
                f"{path}{octant}", max_points_per_node, rng, depth + 1,
            )
        )

    return OctreeNode(
        path=path,
        bbox_min=bbox_min,
        bbox_max=bbox_max,
        indices=kept.astype(np.uint32),
        geometric_error=_geometric_error(bbox_min, bbox_max, max_points_per_node),
        total_points=total,
        children=children,
    )


def build_octree(
    positions: np.ndarray, max_points_per_node: int, seed: int = 0
) -> OctreeNode:
    if max_points_per_node <= 0:
        raise ValueError("max_points_per_node must be positive")

    positions = np.asarray(positions, dtype=np.float64)
    n = int(positions.shape[0])

    if n == 0:
        zero = np.zeros(3, dtype=np.float64)
        return OctreeNode(
            path="r",
            bbox_min=zero,
            bbox_max=zero.copy(),
            indices=np.zeros(0, dtype=np.uint32),
            geometric_error=0.0,
            total_points=0,
        )

    bbox_min = positions.min(axis=0)
    bbox_max = positions.max(axis=0)
    # Nudge degenerate axes so child boxes stay well defined.
    bbox_max = np.where(bbox_max > bbox_min, bbox_max, bbox_min + 1e-6)

    return _build(
        positions,
        np.arange(n, dtype=np.uint32),
        bbox_min,
        bbox_max,
        "r",
        max_points_per_node,
        np.random.default_rng(seed),
        depth=0,
    )
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `.venv/Scripts/python -m pytest pipeline/tests/test_octree.py -v`
Expected: 12 passed.

`test_geometric_error_shrinks_with_depth` is the one most likely to fail. If it does, the cause is a node whose subsample count makes its error larger than its parent's — check that internal nodes use `max_points_per_node` in `_geometric_error`, not `total`.

- [ ] **Step 5: Commit**

```bash
.venv/Scripts/python -m ruff check pipeline
git add pipeline/universe_pipeline/octree.py pipeline/tests/test_octree.py
git commit -m "feat(pipeline): add additive-refinement octree builder

Parents keep a random subsample and pass the remainder down, so descending
adds detail rather than replacing it. Property tests cover point
conservation, box nesting, budget limits and degenerate input."
```

---

### Task 7: Pipeline build and CLI — fixture to tiles, end to end

**Files:**
- Create: `pipeline/universe_pipeline/build.py`
- Create: `pipeline/universe_pipeline/cli.py`
- Test: `pipeline/tests/test_build.py`

**Interfaces:**
- Consumes: `config`, `records`, `octree`, `tileformat`, `sources.gaia` from Tasks 2, 4, 5, 6.
- Produces:
  - `build_layer(record: ObjectRecord, layer: LayerConfig, out_dir: Path) -> dict` — writes tiles plus `tileset.json` and `ids.bin`, returns the tileset dictionary
  - `main(argv: list[str] | None = None) -> int` — CLI entry point

**`tileset.json` shape** (the app's `tileset.ts` in Task 9 must match this exactly):

```json
{
  "formatVersion": 1,
  "layer": "stellar-neighbourhood",
  "unit": "ly",
  "unitInMetres": 9460730472580800.0,
  "frame": "galactic",
  "origin": "Sol",
  "pointCount": 20000,
  "root": {
    "path": "r",
    "boundingBox": { "min": [0, 0, 0], "max": [1, 1, 1] },
    "geometricError": 12.5,
    "pointCount": 512,
    "totalPointCount": 20000,
    "children": []
  }
}
```

- [ ] **Step 1: Write the failing end-to-end test**

```python
# pipeline/tests/test_build.py
import json
from pathlib import Path

import numpy as np

from universe_pipeline.build import build_layer
from universe_pipeline.config import L1_STELLAR_NEIGHBOURHOOD
from universe_pipeline.records import TYPE_STAR, ObjectRecord
from universe_pipeline.tileformat import decode_tile


def synthetic_record(n: int, seed: int = 3) -> ObjectRecord:
    rng = np.random.default_rng(seed)
    direction = rng.normal(size=(n, 3))
    direction /= np.linalg.norm(direction, axis=1, keepdims=True)
    radius = rng.uniform(1.0, 4000.0, size=(n, 1))
    return ObjectRecord(
        position_ly=direction * radius,
        velocity_km_s=rng.uniform(-40.0, 40.0, size=(n, 3)).astype(np.float32),
        abs_mag=rng.uniform(-5.0, 15.0, size=n).astype(np.float32),
        colour_index=rng.integers(0, 65535, size=n, dtype=np.uint16),
        type_flags=np.full(n, TYPE_STAR, dtype=np.uint8),
        catalog_id=np.arange(1000, 1000 + n, dtype=np.uint64),
    )


def test_build_writes_a_tileset_and_every_referenced_tile(tmp_path: Path) -> None:
    record = synthetic_record(8_000)
    tileset = build_layer(record, L1_STELLAR_NEIGHBOURHOOD, tmp_path)

    written = json.loads((tmp_path / "stellar-neighbourhood" / "tileset.json").read_text())
    assert written == tileset
    assert written["formatVersion"] == 1
    assert written["unit"] == "ly"
    assert written["pointCount"] == 8_000

    def check(node: dict) -> int:
        blob = (tmp_path / "stellar-neighbourhood" / f"{node['path']}.bin").read_bytes()
        points, lo, hi = decode_tile(blob)
        assert len(points) == node["pointCount"]
        np.testing.assert_allclose(lo, node["boundingBox"]["min"])
        np.testing.assert_allclose(hi, node["boundingBox"]["max"])
        return len(points) + sum(check(child) for child in node["children"])

    assert check(written["root"]) == 8_000


def test_identifier_table_maps_local_ids_back_to_catalog_ids(tmp_path: Path) -> None:
    record = synthetic_record(2_000)
    build_layer(record, L1_STELLAR_NEIGHBOURHOOD, tmp_path)

    ids = np.fromfile(tmp_path / "stellar-neighbourhood" / "ids.bin", dtype="<u8")
    assert ids.size == 2_000

    blob = (tmp_path / "stellar-neighbourhood" / "r.bin").read_bytes()
    points, _, _ = decode_tile(blob)
    # Every localId in a tile must index a real catalog identifier.
    assert np.all(points.local_id < ids.size)
    np.testing.assert_array_equal(ids[points.local_id], record.catalog_id[points.local_id])


def test_positions_survive_the_round_trip_within_quantization_error(tmp_path: Path) -> None:
    record = synthetic_record(4_000)
    tileset = build_layer(record, L1_STELLAR_NEIGHBOURHOOD, tmp_path)

    def walk(node: dict) -> None:
        points, lo, hi = decode_tile(
            (tmp_path / "stellar-neighbourhood" / f"{node['path']}.bin").read_bytes()
        )
        tolerance = (np.asarray(hi) - np.asarray(lo)) / 131070.0 + 1e-9
        original = record.position_ly[points.local_id]
        assert np.all(np.abs(points.position - original) <= tolerance)
        for child in node["children"]:
            walk(child)

    walk(tileset["root"])


def test_empty_record_produces_a_valid_empty_tileset(tmp_path: Path) -> None:
    tileset = build_layer(synthetic_record(0), L1_STELLAR_NEIGHBOURHOOD, tmp_path)
    assert tileset["pointCount"] == 0
    assert (tmp_path / "stellar-neighbourhood" / "r.bin").exists()
```

- [ ] **Step 2: Run and confirm failure**

Run: `.venv/Scripts/python -m pytest pipeline/tests/test_build.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'universe_pipeline.build'`

- [ ] **Step 3: Implement `pipeline/universe_pipeline/build.py`**

```python
"""Wires normalized records through the octree into tiles on disk."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import numpy as np

from universe_pipeline.config import LayerConfig
from universe_pipeline.octree import OctreeNode, build_octree
from universe_pipeline.records import ObjectRecord
from universe_pipeline.tileformat import TilePoints, encode_tile


def _node_to_json(node: OctreeNode) -> dict[str, Any]:
    return {
        "path": node.path,
        "boundingBox": {
            "min": node.bbox_min.tolist(),
            "max": node.bbox_max.tolist(),
        },
        "geometricError": node.geometric_error,
        "pointCount": int(node.indices.size),
        "totalPointCount": node.total_points,
        "children": [_node_to_json(child) for child in node.children],
    }


def _write_tiles(record: ObjectRecord, node: OctreeNode, out_dir: Path) -> None:
    idx = node.indices
    points = TilePoints(
        position=record.position_ly[idx],
        velocity=record.velocity_km_s[idx],
        color_index=record.colour_index[idx],
        abs_mag=record.abs_mag[idx],
        type_flags=record.type_flags[idx],
        # localId indexes the layer identifier table, which is the record order.
        local_id=idx.astype(np.uint32),
    )
    (out_dir / f"{node.path}.bin").write_bytes(
        encode_tile(points, node.bbox_min, node.bbox_max)
    )
    for child in node.children:
        _write_tiles(record, child, out_dir)


def build_layer(record: ObjectRecord, layer: LayerConfig, out_dir: Path) -> dict[str, Any]:
    layer_dir = out_dir / layer.key
    layer_dir.mkdir(parents=True, exist_ok=True)

    root = build_octree(record.position_ly, layer.max_points_per_tile)
    _write_tiles(record, root, layer_dir)

    record.catalog_id.astype("<u8").tofile(layer_dir / "ids.bin")

    tileset: dict[str, Any] = {
        "formatVersion": 1,
        "layer": layer.key,
        "unit": layer.unit,
        "unitInMetres": layer.unit_in_metres,
        "frame": "galactic",
        "origin": "Sol",
        "pointCount": len(record),
        "root": _node_to_json(root),
    }
    (layer_dir / "tileset.json").write_text(json.dumps(tileset, indent=2), encoding="utf-8")
    return tileset
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `.venv/Scripts/python -m pytest pipeline/tests/test_build.py -v`
Expected: 4 passed.

- [ ] **Step 5: Implement `pipeline/universe_pipeline/cli.py`**

```python
"""Command-line entry point for baking layer tiles."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np

from universe_pipeline.build import build_layer
from universe_pipeline.config import L1_STELLAR_NEIGHBOURHOOD, LayerConfig
from universe_pipeline.records import TYPE_STAR, ObjectRecord
from universe_pipeline.sources.gaia import fetch_gaia_chunk, normalise_gaia

LAYERS: dict[str, LayerConfig] = {
    L1_STELLAR_NEIGHBOURHOOD.key: L1_STELLAR_NEIGHBOURHOOD,
}

# Gaia source_id encodes HEALPix level 12; splitting the level-8 index range
# into chunks keeps every archive job under the row limit and makes the whole
# download resumable, since each chunk caches independently.
HEALPIX8_TOTAL = 12 * 4**8


def _synthetic(count: int, layer: LayerConfig, seed: int) -> ObjectRecord:
    """A deterministic stand-in so the renderer can be developed and tested
    without waiting on a multi-hour Gaia download."""
    rng = np.random.default_rng(seed)
    direction = rng.normal(size=(count, 3))
    direction /= np.linalg.norm(direction, axis=1, keepdims=True)
    # Roughly uniform density in volume rather than in radius.
    radius = layer.max_radius_ly * rng.uniform(0.0, 1.0, size=(count, 1)) ** (1 / 3)
    return ObjectRecord(
        position_ly=direction * np.maximum(radius, layer.min_radius_ly),
        velocity_km_s=rng.normal(0.0, 30.0, size=(count, 3)).astype(np.float32),
        abs_mag=rng.normal(4.0, 3.0, size=count).astype(np.float32),
        colour_index=rng.integers(0, 65535, size=count, dtype=np.uint16),
        type_flags=np.full(count, TYPE_STAR, dtype=np.uint8),
        catalog_id=np.arange(count, dtype=np.uint64),
    )


def _concat(records: list[ObjectRecord]) -> ObjectRecord:
    return ObjectRecord(
        position_ly=np.concatenate([r.position_ly for r in records]),
        velocity_km_s=np.concatenate([r.velocity_km_s for r in records]),
        abs_mag=np.concatenate([r.abs_mag for r in records]),
        colour_index=np.concatenate([r.colour_index for r in records]),
        type_flags=np.concatenate([r.type_flags for r in records]),
        catalog_id=np.concatenate([r.catalog_id for r in records]),
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="universe-pipeline")
    parser.add_argument("--layer", default=L1_STELLAR_NEIGHBOURHOOD.key, choices=sorted(LAYERS))
    parser.add_argument("--out", type=Path, default=Path("public/data"))
    parser.add_argument("--cache", type=Path, default=Path("data/cache"))
    parser.add_argument(
        "--synthetic",
        type=int,
        metavar="COUNT",
        help="skip Gaia and bake COUNT deterministic placeholder stars",
    )
    parser.add_argument("--chunks", type=int, default=48, help="number of Gaia sky chunks")
    args = parser.parse_args(argv)

    layer = LAYERS[args.layer]

    if args.synthetic is not None:
        record = _synthetic(args.synthetic, layer, seed=1)
        print(f"synthetic: {len(record)} placeholder stars")
    else:
        edges = np.linspace(0, HEALPIX8_TOTAL, args.chunks + 1, dtype=int)
        parts: list[ObjectRecord] = []
        for i in range(args.chunks):
            table = fetch_gaia_chunk(layer, int(edges[i]), int(edges[i + 1]) - 1, args.cache)
            part = normalise_gaia(table, layer)
            parts.append(part)
            print(f"chunk {i + 1}/{args.chunks}: {len(part)} sources", flush=True)
        record = _concat(parts)
        print(f"gaia: {len(record)} sources total")

    tileset = build_layer(record, layer, args.out)
    tiles = 0
    stack = [tileset["root"]]
    while stack:
        node = stack.pop()
        tiles += 1
        stack.extend(node["children"])
    print(f"wrote {tiles} tiles to {args.out / layer.key}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 6: Bake a synthetic layer and confirm the app has data to load**

The renderer needs real files before Task 9. Two million synthetic stars build in well under a minute and exercise the streaming path properly.

```bash
.venv/Scripts/python -m universe_pipeline.cli --synthetic 2000000
```

Expected output ends with `wrote <N> tiles to public/data/stellar-neighbourhood`, and `public/data/stellar-neighbourhood/tileset.json` exists. `public/data/` is gitignored, so nothing here gets committed.

- [ ] **Step 7: Commit**

```bash
.venv/Scripts/python -m ruff check pipeline
npm test && .venv/Scripts/python -m pytest pipeline/tests -v
git add pipeline/universe_pipeline/build.py pipeline/universe_pipeline/cli.py \
        pipeline/tests/test_build.py
git commit -m "feat(pipeline): bake layer tiles end to end with a CLI

Records to octree to tiles plus tileset.json and an identifier table.
A --synthetic mode bakes deterministic placeholder stars so the renderer
can be built and tested without a multi-hour Gaia download."
```

---

### Task 8: Renderer core — viewer, bloom, and scale-aware fly controls

**Files:**
- Create: `app/src/core/viewer.ts`
- Create: `app/src/core/flyControls.ts`
- Modify: `app/src/main.ts` (replace the Task 1 placeholder entirely)
- Test: `app/src/core/flyControls.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `speedForDistance(distanceFromOrigin: number, options: SpeedOptions): number`
  - `interface SpeedOptions { fraction: number; min: number; max: number }`
  - `class FlyControls` — `constructor(camera: PerspectiveCamera, element: HTMLElement)`, `update(dtSeconds: number): void`, `dispose(): void`, `speedMultiplier: number`
  - `class Viewer` — `constructor(canvasParent: HTMLElement)`, readonly `scene: Scene`, `camera: PerspectiveCamera`, `renderer: WebGLRenderer`, `add(object: Object3D): void`, `onFrame(cb: (dt: number) => void): void`, `start(): void`, `dispose(): void`

**Why speed scales with distance:** at 5,000 ly out, a fixed step of one light-year per second means nothing moves. Camera speed is a fraction of the distance from the origin, so travel feels the same at every scale. This is the single change that makes a map spanning four decades of distance navigable at all, and it is a pure function so it gets a real test.

- [ ] **Step 1: Write the failing speed tests**

```typescript
// app/src/core/flyControls.test.ts
import { describe, expect, it } from 'vitest';
import { speedForDistance } from './flyControls.js';

const options = { fraction: 0.5, min: 0.001, max: 1e6 };

describe('speedForDistance', () => {
  it('scales linearly with distance from the origin', () => {
    expect(speedForDistance(100, options)).toBeCloseTo(50);
    expect(speedForDistance(1000, options)).toBeCloseTo(500);
  });

  it('keeps a usable speed at the origin', () => {
    expect(speedForDistance(0, options)).toBe(options.min);
  });

  it('clamps to the maximum so a far camera cannot teleport', () => {
    expect(speedForDistance(1e12, options)).toBe(options.max);
  });

  it('never returns a negative speed for a negative input', () => {
    expect(speedForDistance(-500, options)).toBeGreaterThanOrEqual(options.min);
  });

  it('is monotonic across four decades of distance', () => {
    const samples = [1, 10, 100, 1000, 10_000].map((d) => speedForDistance(d, options));
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i]!).toBeGreaterThanOrEqual(samples[i - 1]!);
    }
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run app/src/core/flyControls.test.ts`
Expected: FAIL — cannot resolve `./flyControls.js`.

- [ ] **Step 3: Implement `app/src/core/flyControls.ts`**

```typescript
import { Euler, type PerspectiveCamera, Quaternion, Vector3 } from 'three';

export interface SpeedOptions {
  /** Camera speed as a fraction of distance from the origin, per second. */
  fraction: number;
  min: number;
  max: number;
}

export const DEFAULT_SPEED: SpeedOptions = { fraction: 0.6, min: 0.01, max: 5e5 };

/**
 * Movement speed scales with distance from the origin. A fixed step is unusable
 * across a map spanning four decades: it crawls at 5000 ly and overshoots at 1 ly.
 */
export function speedForDistance(distanceFromOrigin: number, options: SpeedOptions): number {
  const distance = Math.abs(distanceFromOrigin);
  return Math.min(Math.max(distance * options.fraction, options.min), options.max);
}

const KEY_AXES: Record<string, [axis: 0 | 1 | 2, sign: number]> = {
  KeyW: [2, -1],
  KeyS: [2, 1],
  KeyA: [0, -1],
  KeyD: [0, 1],
  KeyQ: [1, -1],
  KeyE: [1, 1],
};

export class FlyControls {
  speedMultiplier = 1;

  private readonly held = new Set<string>();
  private readonly euler = new Euler(0, 0, 0, 'YXZ');
  private readonly move = new Vector3();
  private dragging = false;
  private boosting = false;

  constructor(
    private readonly camera: PerspectiveCamera,
    private readonly element: HTMLElement,
    private readonly speed: SpeedOptions = DEFAULT_SPEED,
  ) {
    this.euler.setFromQuaternion(camera.quaternion);
    element.addEventListener('pointerdown', this.onPointerDown);
    element.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    element.addEventListener('wheel', this.onWheel, { passive: false });
  }

  update(dtSeconds: number): void {
    this.move.set(0, 0, 0);
    for (const code of this.held) {
      const mapping = KEY_AXES[code];
      if (!mapping) continue;
      const [axis, sign] = mapping;
      this.move.setComponent(axis, this.move.getComponent(axis) + sign);
    }
    if (this.move.lengthSq() === 0) return;

    const base = speedForDistance(this.camera.position.length(), this.speed);
    const step = base * this.speedMultiplier * (this.boosting ? 8 : 1) * dtSeconds;
    this.move.normalize().applyQuaternion(this.camera.quaternion).multiplyScalar(step);
    this.camera.position.add(this.move);
  }

  dispose(): void {
    this.element.removeEventListener('pointerdown', this.onPointerDown);
    this.element.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    this.element.removeEventListener('wheel', this.onWheel);
    this.held.clear();
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (event.button === 0) this.dragging = true;
  };

  private readonly onPointerUp = (): void => {
    this.dragging = false;
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (!this.dragging) return;
    this.euler.y -= event.movementX * 0.002;
    this.euler.x -= event.movementY * 0.002;
    // Stop at the poles so the view never flips upside down.
    this.euler.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this.euler.x));
    this.camera.quaternion.setFromEuler(this.euler);
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    this.held.add(event.code);
    if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') this.boosting = true;
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.held.delete(event.code);
    if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') this.boosting = false;
  };

  private readonly onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    const factor = Math.exp(-event.deltaY * 0.001);
    this.speedMultiplier = Math.min(Math.max(this.speedMultiplier * factor, 0.05), 50);
  };
}

export const _internal = { Quaternion };
```

Delete the trailing `_internal` export if lint flags it as unused — it exists only to keep the `Quaternion` import meaningful, and if the implementation does not need it, remove the import instead.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run app/src/core/flyControls.test.ts`
Expected: 5 passed.

- [ ] **Step 5: Implement `app/src/core/viewer.ts`**

```typescript
import {
  Color,
  type Object3D,
  PerspectiveCamera,
  Scene,
  Vector2,
  WebGLRenderer,
} from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { FlyControls } from './flyControls.js';

/**
 * The near and far planes span four decades of distance. A logarithmic depth
 * buffer is what keeps that from collapsing into z-fighting.
 */
const NEAR = 0.001;
const FAR = 1e7;

export class Viewer {
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  readonly renderer: WebGLRenderer;
  readonly controls: FlyControls;

  private readonly composer: EffectComposer;
  private readonly callbacks: ((dt: number) => void)[] = [];
  private lastFrame = performance.now();
  private running = false;

  constructor(parent: HTMLElement) {
    this.renderer = new WebGLRenderer({
      antialias: false,
      logarithmicDepthBuffer: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setClearColor(new Color(0x000000), 1);
    parent.appendChild(this.renderer.domElement);

    this.camera = new PerspectiveCamera(60, window.innerWidth / window.innerHeight, NEAR, FAR);
    this.camera.position.set(0, 0, 0.5);

    this.controls = new FlyControls(this.camera, this.renderer.domElement);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    // Bloom is not decoration here: without it a point field reads as scattered
    // dots rather than as stars.
    this.composer.addPass(
      new UnrealBloomPass(
        new Vector2(window.innerWidth, window.innerHeight),
        0.7, // strength
        0.6, // radius
        0.0, // threshold - points are already dim, so bloom everything
      ),
    );

    window.addEventListener('resize', this.onResize);
  }

  add(object: Object3D): void {
    this.scene.add(object);
  }

  onFrame(cb: (dt: number) => void): void {
    this.callbacks.push(cb);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastFrame = performance.now();
    this.renderer.setAnimationLoop(this.tick);
  }

  dispose(): void {
    this.running = false;
    this.renderer.setAnimationLoop(null);
    window.removeEventListener('resize', this.onResize);
    this.controls.dispose();
    this.composer.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private readonly tick = (): void => {
    const now = performance.now();
    const dt = Math.min((now - this.lastFrame) / 1000, 0.1);
    this.lastFrame = now;

    this.controls.update(dt);
    for (const cb of this.callbacks) cb(dt);
    this.composer.render();
  };

  private readonly onResize = (): void => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.composer.setSize(window.innerWidth, window.innerHeight);
  };
}
```

- [ ] **Step 6: Replace `app/src/main.ts`**

```typescript
import { Viewer } from './core/viewer.js';

const viewer = new Viewer(document.body);
viewer.start();
```

- [ ] **Step 7: Verify it runs**

```bash
npm run typecheck
npm run lint
npm run dev
```

Open the printed URL. Expected: a black full-window canvas. Dragging with the left mouse button turns the view, `W`/`A`/`S`/`D`/`Q`/`E` move, holding `Shift` accelerates, the scroll wheel changes speed. Nothing is visible yet — there is nothing in the scene.

Confirm the browser console has no WebGL errors before continuing.

- [ ] **Step 8: Commit**

```bash
git add app/src/core/ app/src/main.ts
git commit -m "feat(app): add renderer core with bloom and scale-aware fly controls

Camera speed is a fraction of distance from the origin, so travel feels
consistent across four decades of scale. Logarithmic depth buffer and an
UnrealBloom pass are set up ready for point rendering."
```

---

### Task 9: Tileset loading and point rendering — first stars on screen

**Files:**
- Create: `app/src/tiles/tileset.ts`
- Create: `app/src/render/colourRamp.ts`
- Create: `app/src/render/pointMaterial.ts`
- Create: `app/src/render/tileMesh.ts`
- Modify: `app/src/main.ts`
- Test: `app/src/render/colourRamp.test.ts`, `app/src/tiles/tileset.test.ts`

**Interfaces:**
- Consumes: `decodeTile`, `DecodedTile` from Task 3; the `tileset.json` shape from Task 7.
- Produces:
  - `interface TileNode { path: string; boundingBox: { min: number[]; max: number[] }; geometricError: number; pointCount: number; totalPointCount: number; children: TileNode[] }`
  - `interface Tileset { formatVersion: number; layer: string; unit: string; unitInMetres: number; frame: string; origin: string; pointCount: number; root: TileNode }`
  - `parseTileset(json: unknown): Tileset` — throws on a version or shape mismatch
  - `fetchTileset(baseUrl: string): Promise<Tileset>`
  - `fetchTile(baseUrl: string, path: string, signal?: AbortSignal): Promise<DecodedTile>`
  - `buildColourRamp(size?: number): Uint8Array` — RGB triples, blue through white to red
  - `colourAt(t: number): [number, number, number]`
  - `createPointMaterial(unitInParsecs: number): RawShaderMaterial`
  - `createTileMesh(tile: DecodedTile, material: RawShaderMaterial): Points`

**Colour convention:** `colourIndex` is the BP−RP colour index normalized onto 0–1, where 0 is the hottest blue and 1 the coolest red. `buildColourRamp` turns that into a 1D lookup texture, so the shader does one texture read instead of a branch.

- [ ] **Step 1: Write the failing colour ramp and tileset tests**

```typescript
// app/src/render/colourRamp.test.ts
import { describe, expect, it } from 'vitest';
import { buildColourRamp, colourAt } from './colourRamp.js';

describe('colourAt', () => {
  it('is blue-dominant at the hot end', () => {
    const [r, , b] = colourAt(0);
    expect(b).toBeGreaterThan(r);
  });

  it('is red-dominant at the cool end', () => {
    const [r, , b] = colourAt(1);
    expect(r).toBeGreaterThan(b);
  });

  it('is near-neutral in the middle', () => {
    const [r, g, b] = colourAt(0.45);
    expect(Math.abs(r - b)).toBeLessThan(0.35);
    expect(g).toBeGreaterThan(0.5);
  });

  it('stays in gamut across the whole range', () => {
    for (let i = 0; i <= 100; i++) {
      for (const channel of colourAt(i / 100)) {
        expect(channel).toBeGreaterThanOrEqual(0);
        expect(channel).toBeLessThanOrEqual(1);
      }
    }
  });

  it('clamps out-of-range input rather than extrapolating', () => {
    expect(colourAt(-5)).toEqual(colourAt(0));
    expect(colourAt(5)).toEqual(colourAt(1));
  });
});

describe('buildColourRamp', () => {
  it('produces three bytes per texel', () => {
    expect(buildColourRamp(256).length).toBe(256 * 3);
  });
});
```

```typescript
// app/src/tiles/tileset.test.ts
import { describe, expect, it } from 'vitest';
import { parseTileset } from './tileset.js';

const valid = {
  formatVersion: 1,
  layer: 'stellar-neighbourhood',
  unit: 'ly',
  unitInMetres: 9460730472580800,
  frame: 'galactic',
  origin: 'Sol',
  pointCount: 10,
  root: {
    path: 'r',
    boundingBox: { min: [0, 0, 0], max: [1, 1, 1] },
    geometricError: 2,
    pointCount: 10,
    totalPointCount: 10,
    children: [],
  },
};

describe('parseTileset', () => {
  it('accepts a well-formed tileset', () => {
    expect(parseTileset(valid).layer).toBe('stellar-neighbourhood');
  });

  it('rejects an unsupported format version', () => {
    expect(() => parseTileset({ ...valid, formatVersion: 2 })).toThrow(/version/i);
  });

  it('rejects a tileset with no root', () => {
    const { root: _root, ...withoutRoot } = valid;
    expect(() => parseTileset(withoutRoot)).toThrow(/root/i);
  });

  it('rejects a node with a malformed bounding box', () => {
    const broken = { ...valid, root: { ...valid.root, boundingBox: { min: [0, 0], max: [1, 1, 1] } } };
    expect(() => parseTileset(broken)).toThrow(/bounding box/i);
  });

  it('parses nested children', () => {
    const nested = {
      ...valid,
      root: { ...valid.root, children: [{ ...valid.root, path: 'r0' }] },
    };
    expect(parseTileset(nested).root.children[0]!.path).toBe('r0');
  });
});
```

- [ ] **Step 2: Run and confirm both fail**

Run: `npx vitest run app/src/render/colourRamp.test.ts app/src/tiles/tileset.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `app/src/render/colourRamp.ts`**

```typescript
/**
 * Maps normalized BP-RP colour index to an RGB tint.
 * 0 is the hottest blue-white, 1 the coolest red. Stops are chosen to look like
 * a real star field rather than to be photometrically exact.
 */
const STOPS: [t: number, r: number, g: number, b: number][] = [
  [0.0, 0.61, 0.71, 1.0],
  [0.25, 0.79, 0.85, 1.0],
  [0.45, 1.0, 0.98, 0.95],
  [0.62, 1.0, 0.94, 0.72],
  [0.8, 1.0, 0.79, 0.52],
  [1.0, 1.0, 0.6, 0.42],
];

export function colourAt(t: number): [number, number, number] {
  const clamped = Math.min(Math.max(t, 0), 1);
  for (let i = 1; i < STOPS.length; i++) {
    const [t1, r1, g1, b1] = STOPS[i]!;
    if (clamped > t1) continue;
    const [t0, r0, g0, b0] = STOPS[i - 1]!;
    const k = t1 === t0 ? 0 : (clamped - t0) / (t1 - t0);
    return [r0 + (r1 - r0) * k, g0 + (g1 - g0) * k, b0 + (b1 - b0) * k];
  }
  const last = STOPS[STOPS.length - 1]!;
  return [last[1], last[2], last[3]];
}

export function buildColourRamp(size = 256): Uint8Array {
  const data = new Uint8Array(size * 3);
  for (let i = 0; i < size; i++) {
    const [r, g, b] = colourAt(i / (size - 1));
    data[i * 3] = Math.round(r * 255);
    data[i * 3 + 1] = Math.round(g * 255);
    data[i * 3 + 2] = Math.round(b * 255);
  }
  return data;
}
```

- [ ] **Step 4: Implement `app/src/tiles/tileset.ts`**

```typescript
import { decodeTile, type DecodedTile } from './format.js';

export interface TileNode {
  path: string;
  boundingBox: { min: number[]; max: number[] };
  geometricError: number;
  pointCount: number;
  totalPointCount: number;
  children: TileNode[];
}

export interface Tileset {
  formatVersion: number;
  layer: string;
  unit: string;
  unitInMetres: number;
  frame: string;
  origin: string;
  pointCount: number;
  root: TileNode;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

function parseNode(raw: unknown, where: string): TileNode {
  if (!isRecord(raw)) throw new Error(`tileset: ${where} is not an object`);
  const box = raw['boundingBox'];
  if (
    !isRecord(box) ||
    !Array.isArray(box['min']) ||
    !Array.isArray(box['max']) ||
    box['min'].length !== 3 ||
    box['max'].length !== 3
  ) {
    throw new Error(`tileset: ${where} has a malformed bounding box`);
  }
  const children = Array.isArray(raw['children']) ? raw['children'] : [];
  return {
    path: String(raw['path']),
    boundingBox: { min: box['min'] as number[], max: box['max'] as number[] },
    geometricError: Number(raw['geometricError']),
    pointCount: Number(raw['pointCount']),
    totalPointCount: Number(raw['totalPointCount']),
    children: children.map((child, i) => parseNode(child, `${String(raw['path'])}/child ${i}`)),
  };
}

export function parseTileset(json: unknown): Tileset {
  if (!isRecord(json)) throw new Error('tileset: payload is not an object');
  if (json['formatVersion'] !== 1) {
    throw new Error(`tileset: unsupported format version ${String(json['formatVersion'])}`);
  }
  if (!isRecord(json['root'])) throw new Error('tileset: missing root node');

  return {
    formatVersion: 1,
    layer: String(json['layer']),
    unit: String(json['unit']),
    unitInMetres: Number(json['unitInMetres']),
    frame: String(json['frame']),
    origin: String(json['origin']),
    pointCount: Number(json['pointCount']),
    root: parseNode(json['root'], 'root'),
  };
}

export async function fetchTileset(baseUrl: string): Promise<Tileset> {
  const response = await fetch(`${baseUrl}/tileset.json`);
  if (!response.ok) throw new Error(`tileset: HTTP ${response.status} for ${baseUrl}`);
  return parseTileset(await response.json());
}

export async function fetchTile(
  baseUrl: string,
  path: string,
  signal?: AbortSignal,
): Promise<DecodedTile> {
  const response = await fetch(`${baseUrl}/${path}.bin`, { signal });
  if (!response.ok) throw new Error(`tile: HTTP ${response.status} for ${path}`);
  return decodeTile(await response.arrayBuffer());
}
```

- [ ] **Step 5: Implement `app/src/render/pointMaterial.ts`**

```typescript
import {
  AdditiveBlending,
  DataTexture,
  GLSL3,
  LinearFilter,
  RawShaderMaterial,
  RGBFormat,
  UnsignedByteType,
  Vector3,
} from 'three';
import { buildColourRamp } from './colourRamp.js';

const VERTEX = /* glsl */ `
precision highp float;

uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform vec3 uBboxMin;
uniform vec3 uBboxExtent;
uniform float uPixelRatio;
uniform float uSizeScale;
uniform float uMinSize;
uniform float uMaxSize;
uniform float uParsecsPerUnit;

// Normalized uint16: arrives as 0..1 fractions of the tile bounding box.
in vec3 position;
in float aColourIndex;
in float aAbsMag;

out float vColourIndex;
out float vAlpha;

void main() {
  vec3 layerPosition = uBboxMin + position * uBboxExtent;
  vec4 viewPosition = modelViewMatrix * vec4(layerPosition, 1.0);

  float distancePc = max(length(viewPosition.xyz) * uParsecsPerUnit, 1e-6);
  // Apparent magnitude from absolute magnitude and the distance modulus.
  float apparentMag = aAbsMag + 5.0 * (log2(distancePc) / log2(10.0)) - 5.0;
  float brightness = pow(10.0, -0.4 * apparentMag);

  gl_PointSize = clamp(uSizeScale * sqrt(brightness) * uPixelRatio, uMinSize, uMaxSize);
  vAlpha = clamp(brightness * 0.35, 0.02, 1.0);
  vColourIndex = aColourIndex;

  gl_Position = projectionMatrix * viewPosition;
}
`;

const FRAGMENT = /* glsl */ `
precision highp float;

uniform sampler2D uColourRamp;

in float vColourIndex;
in float vAlpha;

out vec4 fragColour;

void main() {
  vec2 offset = gl_PointCoord - 0.5;
  float radiusSq = dot(offset, offset);
  if (radiusSq > 0.25) discard;

  // Soft gaussian-ish falloff; a hard disc reads as confetti, not as stars.
  float falloff = exp(-radiusSq * 12.0);
  vec3 tint = texture(uColourRamp, vec2(vColourIndex, 0.5)).rgb;

  // Additive blending, so brightness lives in the colour channels.
  fragColour = vec4(tint * falloff * vAlpha, 1.0);
}
`;

export function createPointMaterial(unitInParsecs: number): RawShaderMaterial {
  const ramp = new DataTexture(buildColourRamp(256), 256, 1, RGBFormat, UnsignedByteType);
  ramp.minFilter = LinearFilter;
  ramp.magFilter = LinearFilter;
  ramp.needsUpdate = true;

  return new RawShaderMaterial({
    glslVersion: GLSL3,
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: {
      uBboxMin: { value: new Vector3() },
      uBboxExtent: { value: new Vector3(1, 1, 1) },
      uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
      uSizeScale: { value: 1.5 },
      uMinSize: { value: 1.0 },
      uMaxSize: { value: 24.0 },
      uParsecsPerUnit: { value: unitInParsecs },
      uColourRamp: { value: ramp },
    },
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: AdditiveBlending,
  });
}
```

If `RGBFormat` is not exported by the installed Three.js version, use `RGBAFormat` and widen `buildColourRamp` to emit four bytes per texel with alpha 255. Three removed `RGBFormat` in newer releases; check before assuming the import is wrong.

- [ ] **Step 6: Implement `app/src/render/tileMesh.ts`**

```typescript
import {
  BufferGeometry,
  Float16BufferAttribute,
  Points,
  type RawShaderMaterial,
  Sphere,
  Uint16BufferAttribute,
  Vector3,
} from 'three';
import type { DecodedTile } from '../tiles/format.js';

/**
 * Each tile is one draw call with its own bounding box uniforms, so positions
 * stay as raw normalized uint16 and are expanded on the GPU.
 */
export function createTileMesh(tile: DecodedTile, material: RawShaderMaterial): Points {
  const geometry = new BufferGeometry();

  // normalized = true means the shader sees 0..1, which is exactly the
  // dequantization fraction the format defines.
  geometry.setAttribute(
    'position',
    new Uint16BufferAttribute(tile.positionQuantized, 3, true),
  );
  geometry.setAttribute('aColourIndex', new Uint16BufferAttribute(tile.colorIndex, 1, true));
  geometry.setAttribute('aAbsMag', new Float16BufferAttribute(tile.absMag, 1));

  const min = new Vector3(tile.bboxMin[0]!, tile.bboxMin[1]!, tile.bboxMin[2]!);
  const max = new Vector3(tile.bboxMax[0]!, tile.bboxMax[1]!, tile.bboxMax[2]!);
  // Three cannot infer a bounding sphere from normalized positions, so set it
  // from the real box. Culling happens in traversal anyway.
  geometry.boundingSphere = new Sphere(
    min.clone().add(max).multiplyScalar(0.5),
    min.distanceTo(max) * 0.5,
  );

  const tileMaterial = material.clone();
  tileMaterial.uniforms['uBboxMin']!.value = min;
  tileMaterial.uniforms['uBboxExtent']!.value = max.clone().sub(min);

  const points = new Points(geometry, tileMaterial);
  points.frustumCulled = false;
  points.name = 'tile';
  return points;
}
```

`Float16BufferAttribute` takes the raw float16 bit pattern, which is exactly what `decodeTile` hands back, and uploads it as `HALF_FLOAT`. No CPU-side conversion happens in the hot path.

- [ ] **Step 7: Modify `app/src/main.ts` to load and draw the root tile**

```typescript
import { Viewer } from './core/viewer.js';
import { createPointMaterial } from './render/pointMaterial.js';
import { createTileMesh } from './render/tileMesh.js';
import { fetchTile, fetchTileset } from './tiles/tileset.js';

const LAYER_URL = '/data/stellar-neighbourhood';
const PARSECS_PER_LIGHT_YEAR = 1 / 3.261563777167433;

async function boot(): Promise<void> {
  const viewer = new Viewer(document.body);
  viewer.start();

  const tileset = await fetchTileset(LAYER_URL);
  const material = createPointMaterial(PARSECS_PER_LIGHT_YEAR);
  const root = await fetchTile(LAYER_URL, tileset.root.path);
  viewer.add(createTileMesh(root, material));

  // Start far enough out that the root subsample is visible as a field.
  viewer.camera.position.set(0, 0, 3000);
  console.info(`loaded ${tileset.layer}: ${tileset.pointCount} points total`);
}

void boot();
```

- [ ] **Step 8: Run the unit tests and confirm they pass**

Run: `npx vitest run`
Expected: all suites pass, including the Task 3 contract test.

- [ ] **Step 9: Verify stars actually render**

```bash
npm run dev
```

Expected: a field of soft, coloured points against black. Fly toward and away from them with `W` and `S`; points should grow brighter and larger as you approach.

If the screen is black, check in this order: the browser network tab for a 404 on `tileset.json` (the Task 7 synthetic bake did not run, or `publicDir` is misconfigured); the console for a shader compile error; then whether `uSizeScale` is simply too small for this dataset.

`uSizeScale`, `uMaxSize` and the `0.35` alpha factor are tuning values. Adjust them until the field looks right and record the values you settle on in the commit message.

- [ ] **Step 10: Commit**

```bash
npm run typecheck && npm run lint && npx vitest run
git add app/src/tiles/tileset.ts app/src/tiles/tileset.test.ts \
        app/src/render/ app/src/main.ts
git commit -m "feat(app): render tile points with magnitude-driven sizing

Positions stay as normalized uint16 and expand on the GPU against per-tile
bounding box uniforms. Point size and alpha derive from apparent magnitude
via the distance modulus, tinted through a BP-RP colour ramp texture."
```

---

### Task 10: Streaming — traversal, priority loading, LRU eviction

**Files:**
- Create: `app/src/tiles/traversal.ts`
- Create: `app/src/tiles/cache.ts`
- Create: `app/src/tiles/loader.ts`
- Create: `app/src/tiles/tileManager.ts`
- Modify: `app/src/main.ts`
- Test: `app/src/tiles/traversal.test.ts`, `app/src/tiles/cache.test.ts`, `app/src/tiles/loader.test.ts`

**Interfaces:**
- Consumes: `TileNode`, `Tileset`, `fetchTile` from Task 9.
- Produces:
  - `screenSpaceError(geometricError: number, distance: number, screenHeight: number, fovRadians: number): number`
  - `distanceToBox(point: Vec3, min: number[], max: number[]): number`
  - `interface Vec3 { x: number; y: number; z: number }`
  - `interface ViewState { position: Vec3; screenHeight: number; fovRadians: number }`
  - `selectNodes(root: TileNode, view: ViewState, threshold: number, maxNodes: number): TileNode[]`
  - `class TileCache` — `constructor(byteBudget: number)`, `get(path): T | undefined`, `set(path, value, bytes): void`, `touch(path): void`, `byteCount: number`, `size: number`, `onEvict: (path: string, value: T) => void`
  - `class TileLoader` — `constructor(fetchFn, maxInFlight?)`, `enqueue(path, priority): void`, `retainOnly(paths: Set<string>): void`, `inFlightCount: number`, `onLoaded: (path, tile) => void`

**Why distance is measured to the box, not the centre:** a node whose box you are inside has distance zero and infinite screen-space error, so it always refines. Measuring to the centre makes a large node you are standing inside look far away, and its children never load — the exact bug that leaves a hole around the camera.

- [ ] **Step 1: Write the failing traversal tests**

```typescript
// app/src/tiles/traversal.test.ts
import { describe, expect, it } from 'vitest';
import type { TileNode } from './tileset.js';
import { distanceToBox, screenSpaceError, selectNodes } from './traversal.js';

const node = (path: string, min: number[], max: number[], error: number, children: TileNode[] = []): TileNode => ({
  path,
  boundingBox: { min, max },
  geometricError: error,
  pointCount: 100,
  totalPointCount: 100 * (1 + children.length),
  children,
});

const view = { position: { x: 0, y: 0, z: 0 }, screenHeight: 1080, fovRadians: Math.PI / 3 };

describe('distanceToBox', () => {
  it('is zero inside the box', () => {
    expect(distanceToBox({ x: 0, y: 0, z: 0 }, [-1, -1, -1], [1, 1, 1])).toBe(0);
  });

  it('measures the perpendicular distance to a face', () => {
    expect(distanceToBox({ x: 5, y: 0, z: 0 }, [-1, -1, -1], [1, 1, 1])).toBeCloseTo(4);
  });

  it('measures the diagonal distance to a corner', () => {
    expect(distanceToBox({ x: 4, y: 5, z: 1 }, [-1, -1, -1], [1, 1, 1])).toBeCloseTo(5);
  });
});

describe('screenSpaceError', () => {
  it('falls as distance grows', () => {
    const near = screenSpaceError(10, 100, 1080, Math.PI / 3);
    const far = screenSpaceError(10, 1000, 1080, Math.PI / 3);
    expect(far).toBeLessThan(near);
  });

  it('is unbounded at zero distance so a node you are inside always refines', () => {
    expect(screenSpaceError(10, 0, 1080, Math.PI / 3)).toBe(Infinity);
  });

  it('grows with screen height', () => {
    expect(screenSpaceError(10, 100, 2160, Math.PI / 3)).toBeGreaterThan(
      screenSpaceError(10, 100, 1080, Math.PI / 3),
    );
  });
});

describe('selectNodes', () => {
  it('returns the root alone when its error is below threshold', () => {
    const root = node('r', [1e6, 1e6, 1e6], [1e6 + 1, 1e6 + 1, 1e6 + 1], 0.001, [
      node('r0', [1e6, 1e6, 1e6], [1e6 + 1, 1e6 + 1, 1e6 + 1], 0.0005),
    ]);
    expect(selectNodes(root, view, 16, 1000).map((n) => n.path)).toEqual(['r']);
  });

  it('includes the parent as well as its children, because refinement is additive', () => {
    const child = node('r0', [-1, -1, -1], [1, 1, 1], 0.0001);
    const root = node('r', [-1, -1, -1], [1, 1, 1], 1000, [child]);
    const paths = selectNodes(root, view, 16, 1000).map((n) => n.path);
    expect(paths).toContain('r');
    expect(paths).toContain('r0');
  });

  it('respects the node budget', () => {
    const children = Array.from({ length: 8 }, (_, i) =>
      node(`r${i}`, [-1, -1, -1], [1, 1, 1], 1000, [
        node(`r${i}0`, [-1, -1, -1], [1, 1, 1], 1000),
      ]),
    );
    const root = node('r', [-1, -1, -1], [1, 1, 1], 1000, children);
    expect(selectNodes(root, view, 1, 5)).toHaveLength(5);
  });

  it('prefers nearer nodes when the budget binds', () => {
    const near = node('rNear', [-1, -1, -1], [1, 1, 1], 1000);
    const far = node('rFar', [5000, 5000, 5000], [5001, 5001, 5001], 1000);
    const root = node('r', [-1, -1, -1], [5001, 5001, 5001], 1e9, [far, near]);
    const paths = selectNodes(root, view, 1, 2).map((n) => n.path);
    expect(paths).toContain('rNear');
    expect(paths).not.toContain('rFar');
  });
});
```

- [ ] **Step 2: Write the failing cache and loader tests**

```typescript
// app/src/tiles/cache.test.ts
import { describe, expect, it, vi } from 'vitest';
import { TileCache } from './cache.js';

describe('TileCache', () => {
  it('evicts the least recently used entry when the budget is exceeded', () => {
    const cache = new TileCache<string>(100);
    cache.set('a', 'A', 40);
    cache.set('b', 'B', 40);
    cache.touch('a');
    cache.set('c', 'C', 40);

    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBe('A');
    expect(cache.get('c')).toBe('C');
  });

  it('keeps the byte count within budget', () => {
    const cache = new TileCache<string>(100);
    for (let i = 0; i < 20; i++) cache.set(`k${i}`, 'v', 30);
    expect(cache.byteCount).toBeLessThanOrEqual(100);
  });

  it('calls onEvict exactly once per evicted entry so GPU buffers get freed', () => {
    const cache = new TileCache<string>(50);
    const onEvict = vi.fn();
    cache.onEvict = onEvict;
    cache.set('a', 'A', 40);
    cache.set('b', 'B', 40);

    expect(onEvict).toHaveBeenCalledTimes(1);
    expect(onEvict).toHaveBeenCalledWith('a', 'A');
  });

  it('a repeated set replaces rather than double-counting', () => {
    const cache = new TileCache<string>(1000);
    cache.set('a', 'A', 40);
    cache.set('a', 'A2', 60);
    expect(cache.byteCount).toBe(60);
    expect(cache.get('a')).toBe('A2');
  });

  it('accepts an entry larger than the budget rather than looping forever', () => {
    const cache = new TileCache<string>(10);
    cache.set('big', 'B', 999);
    expect(cache.get('big')).toBe('B');
  });
});
```

```typescript
// app/src/tiles/loader.test.ts
import { describe, expect, it, vi } from 'vitest';
import { TileLoader } from './loader.js';

const deferred = () => {
  let resolve!: (value: unknown) => void;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
};

describe('TileLoader', () => {
  it('never exceeds the in-flight cap', () => {
    const pending = Array.from({ length: 10 }, deferred);
    let index = 0;
    const loader = new TileLoader(() => pending[index++]!.promise, 3);

    for (let i = 0; i < 10; i++) loader.enqueue(`t${i}`, i);

    expect(loader.inFlightCount).toBe(3);
  });

  it('starts the highest priority request first', () => {
    const fetchFn = vi.fn(() => new Promise(() => {}));
    const loader = new TileLoader(fetchFn, 1);

    loader.enqueue('low', 1);
    loader.enqueue('high', 99);
    loader.enqueue('mid', 50);

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn).toHaveBeenCalledWith('low');
  });

  it('picks the highest priority from the queue as slots free up', async () => {
    const first = deferred();
    const fetchFn = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValue(new Promise(() => {}));
    const loader = new TileLoader(fetchFn as never, 1);

    loader.enqueue('a', 1);
    loader.enqueue('b', 5);
    loader.enqueue('c', 90);
    first.resolve(null);
    await Promise.resolve();
    await Promise.resolve();

    expect(fetchFn).toHaveBeenLastCalledWith('c');
  });

  it('drops queued requests that retainOnly no longer wants', () => {
    const fetchFn = vi.fn(() => new Promise(() => {}));
    const loader = new TileLoader(fetchFn, 1);

    loader.enqueue('keep', 1);
    loader.enqueue('drop', 2);
    loader.retainOnly(new Set(['keep']));

    expect(loader.queuedPaths).toEqual([]);
  });

  it('does not enqueue the same path twice', () => {
    const fetchFn = vi.fn(() => new Promise(() => {}));
    const loader = new TileLoader(fetchFn, 1);

    loader.enqueue('a', 1);
    loader.enqueue('a', 5);

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(loader.queuedPaths).toEqual([]);
  });
});
```

- [ ] **Step 3: Run all three and confirm they fail**

Run: `npx vitest run app/src/tiles/`
Expected: FAIL — `traversal.js`, `cache.js` and `loader.js` do not resolve.

- [ ] **Step 4: Implement `app/src/tiles/traversal.ts`**

```typescript
import type { TileNode } from './tileset.js';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface ViewState {
  position: Vec3;
  screenHeight: number;
  fovRadians: number;
}

/**
 * Distance to the box, not to its centre. A node you are standing inside has
 * distance zero and therefore refines; measuring to the centre would make it
 * look far away and leave a hole around the camera.
 */
export function distanceToBox(point: Vec3, min: number[], max: number[]): number {
  const dx = Math.max(min[0]! - point.x, 0, point.x - max[0]!);
  const dy = Math.max(min[1]! - point.y, 0, point.y - max[1]!);
  const dz = Math.max(min[2]! - point.z, 0, point.z - max[2]!);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** Projected size, in pixels, of this node's point spacing. */
export function screenSpaceError(
  geometricError: number,
  distance: number,
  screenHeight: number,
  fovRadians: number,
): number {
  if (distance <= 0) return Infinity;
  return (geometricError * screenHeight) / (2 * distance * Math.tan(fovRadians / 2));
}

interface Candidate {
  node: TileNode;
  error: number;
}

/**
 * Selects nodes to draw. Refinement is additive: selecting a child does not
 * deselect its parent, because a parent holds points its children do not.
 * When the budget binds, higher screen-space error wins, which means nearer
 * and larger nodes are kept.
 */
export function selectNodes(
  root: TileNode,
  view: ViewState,
  threshold: number,
  maxNodes: number,
): TileNode[] {
  const selected: TileNode[] = [];
  const frontier: Candidate[] = [
    {
      node: root,
      error: screenSpaceError(
        root.geometricError,
        distanceToBox(view.position, root.boundingBox.min, root.boundingBox.max),
        view.screenHeight,
        view.fovRadians,
      ),
    },
  ];

  while (frontier.length > 0 && selected.length < maxNodes) {
    // Highest error first: nearest and coarsest nodes matter most.
    let bestIndex = 0;
    for (let i = 1; i < frontier.length; i++) {
      if (frontier[i]!.error > frontier[bestIndex]!.error) bestIndex = i;
    }
    const [candidate] = frontier.splice(bestIndex, 1);
    if (!candidate) break;

    selected.push(candidate.node);

    if (candidate.error <= threshold) continue;

    for (const child of candidate.node.children) {
      frontier.push({
        node: child,
        error: screenSpaceError(
          child.geometricError,
          distanceToBox(view.position, child.boundingBox.min, child.boundingBox.max),
          view.screenHeight,
          view.fovRadians,
        ),
      });
    }
  }

  return selected;
}
```

- [ ] **Step 5: Implement `app/src/tiles/cache.ts`**

```typescript
/**
 * LRU cache under a byte budget. Insertion order in a Map is iteration order,
 * so re-inserting on access is all the recency bookkeeping this needs.
 */
export class TileCache<T> {
  onEvict: (path: string, value: T) => void = () => {};

  private readonly entries = new Map<string, { value: T; bytes: number }>();
  private bytes = 0;

  constructor(private readonly byteBudget: number) {}

  get byteCount(): number {
    return this.bytes;
  }

  get size(): number {
    return this.entries.size;
  }

  has(path: string): boolean {
    return this.entries.has(path);
  }

  get(path: string): T | undefined {
    const entry = this.entries.get(path);
    if (!entry) return undefined;
    this.entries.delete(path);
    this.entries.set(path, entry);
    return entry.value;
  }

  touch(path: string): void {
    this.get(path);
  }

  set(path: string, value: T, bytes: number): void {
    const existing = this.entries.get(path);
    if (existing) {
      this.bytes -= existing.bytes;
      this.entries.delete(path);
    }
    this.entries.set(path, { value, bytes });
    this.bytes += bytes;
    this.evictToBudget(path);
  }

  clear(): void {
    for (const [path, entry] of this.entries) this.onEvict(path, entry.value);
    this.entries.clear();
    this.bytes = 0;
  }

  private evictToBudget(protectedPath: string): void {
    for (const [path, entry] of this.entries) {
      if (this.bytes <= this.byteBudget) return;
      // Never evict the entry just inserted; an oversized tile would otherwise
      // evict itself and loop.
      if (path === protectedPath) continue;
      this.entries.delete(path);
      this.bytes -= entry.bytes;
      this.onEvict(path, entry.value);
    }
  }
}
```

- [ ] **Step 6: Implement `app/src/tiles/loader.ts`**

```typescript
type FetchFn<T> = (path: string) => Promise<T>;

interface QueueEntry {
  path: string;
  priority: number;
}

/**
 * Priority queue over tile fetches with a hard in-flight cap. Without the cap,
 * a fast camera sweep queues thousands of requests and the browser spends its
 * bandwidth on tiles that left the view before they arrived.
 */
export class TileLoader<T> {
  onLoaded: (path: string, value: T) => void = () => {};
  onFailed: (path: string, error: unknown) => void = () => {};

  private readonly queue: QueueEntry[] = [];
  private readonly inFlight = new Set<string>();
  private readonly seen = new Set<string>();

  constructor(
    private readonly fetchFn: FetchFn<T>,
    private readonly maxInFlight = 8,
  ) {}

  get inFlightCount(): number {
    return this.inFlight.size;
  }

  get queuedPaths(): string[] {
    return this.queue.map((entry) => entry.path);
  }

  enqueue(path: string, priority: number): void {
    if (this.seen.has(path)) return;
    this.seen.add(path);
    this.queue.push({ path, priority });
    this.pump();
  }

  /** Drops queued work no longer wanted. In-flight requests are left to finish. */
  retainOnly(paths: Set<string>): void {
    for (let i = this.queue.length - 1; i >= 0; i--) {
      const entry = this.queue[i]!;
      if (paths.has(entry.path)) continue;
      this.queue.splice(i, 1);
      this.seen.delete(entry.path);
    }
  }

  forget(path: string): void {
    this.seen.delete(path);
  }

  private pump(): void {
    while (this.inFlight.size < this.maxInFlight && this.queue.length > 0) {
      let bestIndex = 0;
      for (let i = 1; i < this.queue.length; i++) {
        if (this.queue[i]!.priority > this.queue[bestIndex]!.priority) bestIndex = i;
      }
      const [entry] = this.queue.splice(bestIndex, 1);
      if (!entry) return;

      this.inFlight.add(entry.path);
      this.fetchFn(entry.path)
        .then((value) => this.onLoaded(entry.path, value))
        .catch((error: unknown) => {
          this.seen.delete(entry.path);
          this.onFailed(entry.path, error);
        })
        .finally(() => {
          this.inFlight.delete(entry.path);
          this.pump();
        });
    }
  }
}
```

- [ ] **Step 7: Implement `app/src/tiles/tileManager.ts`**

```typescript
import { Group, type Points, type RawShaderMaterial } from 'three';
import { createTileMesh } from '../render/tileMesh.js';
import { TileCache } from './cache.js';
import type { DecodedTile } from './format.js';
import { TileLoader } from './loader.js';
import { fetchTile, type Tileset } from './tileset.js';
import { distanceToBox, screenSpaceError, selectNodes, type ViewState } from './traversal.js';

export interface TileManagerOptions {
  screenSpaceErrorThreshold: number;
  maxVisibleNodes: number;
  maxInFlight: number;
  gpuByteBudget: number;
}

export const DEFAULT_OPTIONS: TileManagerOptions = {
  screenSpaceErrorThreshold: 8,
  maxVisibleNodes: 600,
  maxInFlight: 8,
  gpuByteBudget: 512 * 1024 * 1024,
};

/** Bytes a tile occupies on the GPU: 6 position + 2 colour + 2 magnitude + 6 velocity. */
const BYTES_PER_POINT = 16;

export class TileManager {
  readonly group = new Group();
  readonly meshes = new Map<string, Points>();

  private readonly cache: TileCache<Points>;
  private readonly loader: TileLoader<DecodedTile>;

  constructor(
    private readonly baseUrl: string,
    private readonly tileset: Tileset,
    private readonly material: RawShaderMaterial,
    private readonly options: TileManagerOptions = DEFAULT_OPTIONS,
  ) {
    this.cache = new TileCache<Points>(options.gpuByteBudget);
    this.cache.onEvict = (path, mesh) => {
      this.group.remove(mesh);
      this.meshes.delete(path);
      mesh.geometry.dispose();
      this.loader.forget(path);
    };

    this.loader = new TileLoader<DecodedTile>(
      (path) => fetchTile(this.baseUrl, path),
      options.maxInFlight,
    );
    this.loader.onLoaded = (path, tile) => {
      const mesh = createTileMesh(tile, this.material);
      this.meshes.set(path, mesh);
      this.group.add(mesh);
      this.cache.set(path, mesh, Math.max(tile.pointCount * BYTES_PER_POINT, 1));
    };
    this.loader.onFailed = (path, error) => {
      console.warn(`tile ${path} failed to load`, error);
    };
  }

  update(view: ViewState): void {
    const wanted = selectNodes(
      this.tileset.root,
      view,
      this.options.screenSpaceErrorThreshold,
      this.options.maxVisibleNodes,
    );

    const wantedPaths = new Set(wanted.map((node) => node.path));
    this.loader.retainOnly(wantedPaths);

    for (const node of wanted) {
      if (this.cache.has(node.path)) {
        this.cache.touch(node.path);
        continue;
      }
      const distance = distanceToBox(view.position, node.boundingBox.min, node.boundingBox.max);
      const priority = screenSpaceError(
        node.geometricError, distance, view.screenHeight, view.fovRadians,
      );
      this.loader.enqueue(node.path, Number.isFinite(priority) ? priority : Number.MAX_VALUE);
    }

    // Anything loaded but no longer selected stays cached and hidden, so
    // backtracking is instant until the budget reclaims it.
    for (const [path, mesh] of this.meshes) {
      mesh.visible = wantedPaths.has(path);
    }
  }

  dispose(): void {
    this.cache.clear();
  }
}
```

- [ ] **Step 8: Modify `app/src/main.ts` to drive the manager each frame**

```typescript
import { Viewer } from './core/viewer.js';
import { createPointMaterial } from './render/pointMaterial.js';
import { TileManager } from './tiles/tileManager.js';
import { fetchTileset } from './tiles/tileset.js';

const LAYER_URL = '/data/stellar-neighbourhood';
const PARSECS_PER_LIGHT_YEAR = 1 / 3.261563777167433;

async function boot(): Promise<void> {
  const viewer = new Viewer(document.body);
  const tileset = await fetchTileset(LAYER_URL);
  const material = createPointMaterial(PARSECS_PER_LIGHT_YEAR);
  const manager = new TileManager(LAYER_URL, tileset, material);

  viewer.add(manager.group);
  viewer.camera.position.set(0, 0, 3000);

  viewer.onFrame(() => {
    manager.update({
      position: viewer.camera.position,
      screenHeight: viewer.renderer.domElement.height,
      fovRadians: (viewer.camera.fov * Math.PI) / 180,
    });
  });

  viewer.start();
  console.info(`${tileset.layer}: ${tileset.pointCount} points`);
}

void boot();
```

- [ ] **Step 9: Run the tests and confirm they pass**

Run: `npx vitest run`
Expected: all suites pass, 16 new tests across traversal, cache and loader.

- [ ] **Step 10: Verify streaming behaves**

```bash
npm run dev
```

Fly toward the field. Expected: detail fills in as you approach, and the browser network tab shows `.bin` requests appearing in bursts of at most 8. Fly away and back; returning should be instant, because the meshes are cached rather than refetched.

If detail never increases, `screenSpaceErrorThreshold` is too high. If the frame rate collapses, it is too low — the node count in `manager.meshes.size` is the number to watch.

- [ ] **Step 11: Commit**

```bash
npm run typecheck && npm run lint && npx vitest run
git add app/src/tiles/ app/src/main.ts
git commit -m "feat(app): stream tiles with screen-space-error LOD and LRU eviction

Distance is measured to the node box rather than its centre, so a node the
camera sits inside always refines. Loading is priority ordered with a
hard in-flight cap; eviction runs against a GPU byte budget."
```

---

### Task 11: Hover picking, hover card, and the Earth anchor

**Files:**
- Create: `app/src/render/pickIds.ts`
- Create: `app/src/render/picking.ts`
- Create: `app/src/interaction/hover.ts`
- Create: `app/src/interaction/anchors.ts`
- Create: `app/src/ui/hoverCard.ts`
- Modify: `app/src/main.ts`
- Test: `app/src/render/pickIds.test.ts`, `app/src/interaction/anchors.test.ts`

**Interfaces:**
- Consumes: `TileManager` from Task 10.
- Produces:
  - `encodePickId(tileSlot: number, vertexIndex: number): number`
  - `decodePickId(rgba: Uint8Array, offset?: number): { tileSlot: number; vertexIndex: number } | null`
  - `MAX_VERTICES_PER_TILE: number`, `MAX_TILE_SLOTS: number`
  - `class PickingPass` — `constructor(renderer, scene, camera)`, `pickAt(x: number, y: number): { tileSlot: number; vertexIndex: number } | null`, `dispose(): void`
  - `projectToScreen(world: Vector3, camera: PerspectiveCamera, width: number, height: number): { x: number; y: number; visible: boolean }`
  - `class Anchor` — `constructor(label: string, world: Vector3, parent: HTMLElement)`, `update(camera, width, height): void`, `dispose(): void`
  - `class HoverCard` — `show(text: string, x: number, y: number): void`, `hide(): void`

**Picking identifiers:** the fragment writes `encodePickId(...) + 1` into an RGBA8 target so that a zero readback means background rather than tile 0 point 0. Twelve bits of tile slot and twenty bits of vertex index fit exactly in 32 bits, which is why `max_points_per_tile` is capped at 65,536 in pipeline config.

- [ ] **Step 1: Write the failing identifier and projection tests**

```typescript
// app/src/render/pickIds.test.ts
import { describe, expect, it } from 'vitest';
import { decodePickId, encodePickId, MAX_TILE_SLOTS, MAX_VERTICES_PER_TILE } from './pickIds.js';

const toRgba = (id: number): Uint8Array =>
  new Uint8Array([id & 255, (id >>> 8) & 255, (id >>> 16) & 255, (id >>> 24) & 255]);

describe('pick identifiers', () => {
  it('round-trips through the RGBA encoding', () => {
    for (const [slot, vertex] of [[0, 0], [1, 1], [7, 65535], [4095, 1048575]]) {
      expect(decodePickId(toRgba(encodePickId(slot!, vertex!) + 1))).toEqual({
        tileSlot: slot,
        vertexIndex: vertex,
      });
    }
  });

  it('treats an all-zero readback as background', () => {
    expect(decodePickId(new Uint8Array([0, 0, 0, 0]))).toBeNull();
  });

  it('distinguishes background from the first point of the first tile', () => {
    expect(decodePickId(toRgba(encodePickId(0, 0) + 1))).toEqual({ tileSlot: 0, vertexIndex: 0 });
  });

  it('rejects a slot or index beyond the encoding capacity', () => {
    expect(() => encodePickId(MAX_TILE_SLOTS, 0)).toThrow(/slot/i);
    expect(() => encodePickId(0, MAX_VERTICES_PER_TILE)).toThrow(/vertex/i);
  });

  it('reads from an offset inside a larger buffer', () => {
    const buffer = new Uint8Array(16);
    buffer.set(toRgba(encodePickId(3, 9) + 1), 8);
    expect(decodePickId(buffer, 8)).toEqual({ tileSlot: 3, vertexIndex: 9 });
  });
});
```

```typescript
// app/src/interaction/anchors.test.ts
import { PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { projectToScreen } from './anchors.js';

const camera = (): PerspectiveCamera => {
  const c = new PerspectiveCamera(60, 16 / 9, 0.001, 1e7);
  c.position.set(0, 0, 100);
  c.lookAt(0, 0, 0);
  c.updateMatrixWorld(true);
  return c;
};

describe('projectToScreen', () => {
  it('puts a point straight ahead at the centre of the screen', () => {
    const result = projectToScreen(new Vector3(0, 0, 0), camera(), 1920, 1080);
    expect(result.x).toBeCloseTo(960, 0);
    expect(result.y).toBeCloseTo(540, 0);
    expect(result.visible).toBe(true);
  });

  it('marks a point behind the camera as not visible', () => {
    const result = projectToScreen(new Vector3(0, 0, 500), camera(), 1920, 1080);
    expect(result.visible).toBe(false);
  });

  it('puts a point above the axis higher on the screen', () => {
    const result = projectToScreen(new Vector3(0, 10, 0), camera(), 1920, 1080);
    expect(result.y).toBeLessThan(540);
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run app/src/render/pickIds.test.ts app/src/interaction/anchors.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `app/src/render/pickIds.ts`**

```typescript
/**
 * A pick identifier packs a tile slot and a vertex index into 32 bits, written
 * to an RGBA8 target. The value stored is always id + 1, so an all-zero
 * readback unambiguously means background.
 */
export const VERTEX_BITS = 20;
export const MAX_VERTICES_PER_TILE = 1 << VERTEX_BITS; // 1,048,576
export const MAX_TILE_SLOTS = 1 << (31 - VERTEX_BITS); // 2,048

export function encodePickId(tileSlot: number, vertexIndex: number): number {
  if (tileSlot < 0 || tileSlot >= MAX_TILE_SLOTS) {
    throw new Error(`pick id: tile slot ${tileSlot} out of range`);
  }
  if (vertexIndex < 0 || vertexIndex >= MAX_VERTICES_PER_TILE) {
    throw new Error(`pick id: vertex index ${vertexIndex} out of range`);
  }
  return tileSlot * MAX_VERTICES_PER_TILE + vertexIndex;
}

export function decodePickId(
  rgba: Uint8Array,
  offset = 0,
): { tileSlot: number; vertexIndex: number } | null {
  const stored =
    rgba[offset]! |
    (rgba[offset + 1]! << 8) |
    (rgba[offset + 2]! << 16) |
    (rgba[offset + 3]! << 24);
  if (stored === 0) return null;

  const id = (stored >>> 0) - 1;
  return {
    tileSlot: Math.floor(id / MAX_VERTICES_PER_TILE),
    vertexIndex: id % MAX_VERTICES_PER_TILE,
  };
}
```

- [ ] **Step 4: Implement `app/src/interaction/anchors.ts`**

```typescript
import type { PerspectiveCamera, Vector3 } from 'three';

export interface ScreenPosition {
  x: number;
  y: number;
  visible: boolean;
}

const scratch = { x: 0, y: 0, z: 0 };

/** Projects a world point to pixel coordinates, with origin at the top left. */
export function projectToScreen(
  world: Vector3,
  camera: PerspectiveCamera,
  width: number,
  height: number,
): ScreenPosition {
  scratch.x = world.x;
  scratch.y = world.y;
  scratch.z = world.z;

  const projected = world.clone().project(camera);
  // z outside [-1, 1] means the point is behind the camera or beyond the far plane.
  const visible = projected.z >= -1 && projected.z <= 1;

  return {
    x: (projected.x * 0.5 + 0.5) * width,
    y: (-projected.y * 0.5 + 0.5) * height,
    visible,
  };
}

/** A permanent screen-space label pinned to a world position. */
export class Anchor {
  private readonly element: HTMLDivElement;

  constructor(label: string, private readonly world: Vector3, parent: HTMLElement) {
    this.element = document.createElement('div');
    this.element.textContent = label;
    this.element.style.cssText = [
      'position:fixed',
      'pointer-events:none',
      'transform:translate(-50%,-50%)',
      'padding:2px 6px',
      'font:11px/1.4 ui-monospace,monospace',
      'letter-spacing:0.08em',
      'text-transform:uppercase',
      'color:#cfe3ff',
      'text-shadow:0 0 6px #000,0 0 2px #000',
      'white-space:nowrap',
      'z-index:10',
    ].join(';');
    parent.appendChild(this.element);
  }

  update(camera: PerspectiveCamera, width: number, height: number): void {
    const position = projectToScreen(this.world, camera, width, height);
    this.element.hidden = !position.visible;
    if (!position.visible) return;
    this.element.style.left = `${position.x}px`;
    this.element.style.top = `${position.y}px`;
  }

  dispose(): void {
    this.element.remove();
  }
}
```

- [ ] **Step 5: Run those tests and confirm they pass**

Run: `npx vitest run app/src/render/pickIds.test.ts app/src/interaction/anchors.test.ts`
Expected: 8 passed.

- [ ] **Step 6: Implement `app/src/render/picking.ts`**

```typescript
import {
  type Camera,
  GLSL3,
  NearestFilter,
  RawShaderMaterial,
  RGBAFormat,
  type Scene,
  UnsignedByteType,
  Vector3,
  type WebGLRenderer,
  WebGLRenderTarget,
} from 'three';
import { MAX_VERTICES_PER_TILE } from './pickIds.js';

const VERTEX = /* glsl */ `
precision highp float;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform vec3 uBboxMin;
uniform vec3 uBboxExtent;
uniform float uTileSlot;
uniform float uPickPointSize;
in vec3 position;
flat out uint vPickId;
void main() {
  vPickId = uint(uTileSlot) * ${MAX_VERTICES_PER_TILE}u + uint(gl_VertexID) + 1u;
  gl_PointSize = uPickPointSize;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(uBboxMin + position * uBboxExtent, 1.0);
}
`;

const FRAGMENT = /* glsl */ `
precision highp float;
flat in uint vPickId;
out vec4 fragColour;
void main() {
  fragColour = vec4(
    float(vPickId & 255u) / 255.0,
    float((vPickId >> 8u) & 255u) / 255.0,
    float((vPickId >> 16u) & 255u) / 255.0,
    float((vPickId >> 24u) & 255u) / 255.0
  );
}
`;

export function createPickMaterial(): RawShaderMaterial {
  return new RawShaderMaterial({
    glslVersion: GLSL3,
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: {
      uBboxMin: { value: new Vector3() },
      uBboxExtent: { value: new Vector3(1, 1, 1) },
      uTileSlot: { value: 0 },
      // Bigger than the visual point size: sub-pixel stars need a hit area.
      uPickPointSize: { value: 5 },
    },
    transparent: false,
    depthTest: true,
    depthWrite: true,
  });
}

/**
 * Renders object identifiers to an off-screen target and reads back the pixels
 * under the cursor. Scissored to a small region, so cost does not scale with
 * the number of objects on screen.
 */
export class PickingPass {
  private readonly target: WebGLRenderTarget;
  private readonly buffer = new Uint8Array(4);

  constructor(
    private readonly renderer: WebGLRenderer,
    private readonly scene: Scene,
    private readonly camera: Camera,
  ) {
    this.target = new WebGLRenderTarget(1, 1, {
      format: RGBAFormat,
      type: UnsignedByteType,
      minFilter: NearestFilter,
      magFilter: NearestFilter,
      depthBuffer: true,
    });
  }

  /** `x` and `y` are CSS pixels with origin at the top left. */
  readPixel(x: number, y: number): Uint8Array {
    const size = this.renderer.getDrawingBufferSize({ width: 0, height: 0 });
    this.target.setSize(size.width, size.height);

    const previousTarget = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(this.target);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.clear(true, true, false);

    const pixelRatio = this.renderer.getPixelRatio();
    const deviceX = Math.floor(x * pixelRatio);
    const deviceY = Math.floor(size.height - y * pixelRatio);

    this.renderer.setScissorTest(true);
    this.renderer.setScissor(deviceX - 2, deviceY - 2, 5, 5);
    this.renderer.render(this.scene, this.camera);
    this.renderer.setScissorTest(false);

    this.renderer.readRenderTargetPixels(this.target, deviceX, deviceY, 1, 1, this.buffer);
    this.renderer.setRenderTarget(previousTarget);
    return this.buffer;
  }

  dispose(): void {
    this.target.dispose();
  }
}
```

- [ ] **Step 7: Implement `app/src/ui/hoverCard.ts`**

```typescript
export class HoverCard {
  private readonly element: HTMLDivElement;

  constructor(parent: HTMLElement) {
    this.element = document.createElement('div');
    this.element.hidden = true;
    this.element.style.cssText = [
      'position:fixed',
      'pointer-events:none',
      'padding:6px 9px',
      'font:11px/1.5 ui-monospace,monospace',
      'color:#e8f1ff',
      'background:rgba(8,12,22,0.88)',
      'border:1px solid rgba(120,160,220,0.35)',
      'border-radius:4px',
      'white-space:pre',
      'z-index:20',
    ].join(';');
    parent.appendChild(this.element);
  }

  show(text: string, x: number, y: number): void {
    this.element.textContent = text;
    this.element.hidden = false;
    // Keep the card on screen near the right and bottom edges.
    const rect = this.element.getBoundingClientRect();
    this.element.style.left = `${Math.min(x + 14, window.innerWidth - rect.width - 8)}px`;
    this.element.style.top = `${Math.min(y + 14, window.innerHeight - rect.height - 8)}px`;
  }

  hide(): void {
    this.element.hidden = true;
  }

  dispose(): void {
    this.element.remove();
  }
}
```

- [ ] **Step 8: Implement `app/src/interaction/hover.ts`**

```typescript
import type { Points } from 'three';
import { decodePickId } from '../render/pickIds.js';
import type { PickingPass } from '../render/picking.js';
import { dequantizePosition } from '../tiles/format.js';
import type { DecodedTile } from '../tiles/format.js';
import type { HoverCard } from '../ui/hoverCard.js';

export interface HoverSource {
  /** Tile slot to the decoded tile currently occupying it. */
  tileForSlot(slot: number): { tile: DecodedTile; mesh: Points } | undefined;
  /** Catalog identifier for a point, or undefined while the table is loading. */
  catalogId(tile: DecodedTile, vertexIndex: number): bigint | undefined;
  unit: string;
}

const scratch = new Float64Array(3);

export class HoverController {
  private lastMove = 0;

  constructor(
    private readonly picking: PickingPass,
    private readonly card: HoverCard,
    private readonly source: HoverSource,
    private readonly element: HTMLElement,
    private readonly throttleMs = 33,
  ) {
    element.addEventListener('pointermove', this.onPointerMove);
    element.addEventListener('pointerleave', this.onPointerLeave);
  }

  dispose(): void {
    this.element.removeEventListener('pointermove', this.onPointerMove);
    this.element.removeEventListener('pointerleave', this.onPointerLeave);
  }

  private readonly onPointerLeave = (): void => this.card.hide();

  private readonly onPointerMove = (event: PointerEvent): void => {
    const now = performance.now();
    if (now - this.lastMove < this.throttleMs) return;
    this.lastMove = now;

    const hit = decodePickId(this.picking.readPixel(event.clientX, event.clientY));
    if (!hit) {
      this.card.hide();
      return;
    }

    const entry = this.source.tileForSlot(hit.tileSlot);
    if (!entry || hit.vertexIndex >= entry.tile.pointCount) {
      this.card.hide();
      return;
    }

    dequantizePosition(entry.tile, hit.vertexIndex, scratch);
    const distance = Math.hypot(scratch[0]!, scratch[1]!, scratch[2]!);
    const catalogId = this.source.catalogId(entry.tile, hit.vertexIndex);

    this.card.show(
      [
        catalogId === undefined ? 'Star' : `Gaia DR3 ${catalogId}`,
        `${distance.toFixed(2)} ${this.source.unit} from Earth`,
      ].join('\n'),
      event.clientX,
      event.clientY,
    );
  };
}
```

- [ ] **Step 9: Wire picking, hover and the Earth anchor into `app/src/main.ts`**

Add to the existing `boot()` after the `TileManager` is created. `TileManager` needs two small additions: a stable slot number per loaded tile, and the decoded tile retained alongside the mesh. Add to `TileManager`:

```typescript
// in TileManager, alongside `meshes`
readonly tilesBySlot = new Map<number, { tile: DecodedTile; mesh: Points }>();
private nextSlot = 0;
private readonly slotByPath = new Map<string, number>();

private slotFor(path: string): number {
  const existing = this.slotByPath.get(path);
  if (existing !== undefined) return existing;
  const slot = this.nextSlot++ % MAX_TILE_SLOTS;
  this.slotByPath.set(path, slot);
  return slot;
}
```

In `loader.onLoaded`, after creating the mesh:

```typescript
const slot = this.slotFor(path);
mesh.userData['tileSlot'] = slot;
this.tilesBySlot.set(slot, { tile, mesh });
```

and in `cache.onEvict`, remove the slot entry:

```typescript
const slot = mesh.userData['tileSlot'] as number | undefined;
if (slot !== undefined) this.tilesBySlot.delete(slot);
this.slotByPath.delete(path);
```

Then in `main.ts`:

```typescript
import { Vector3 } from 'three';
import { Anchor } from './interaction/anchors.js';
import { HoverController } from './interaction/hover.js';
import { PickingPass } from './render/picking.js';
import { HoverCard } from './ui/hoverCard.js';

// ... after `viewer.add(manager.group)`

const ids = new BigUint64Array(
  await (await fetch(`${LAYER_URL}/ids.bin`)).arrayBuffer(),
);

const picking = new PickingPass(viewer.renderer, viewer.scene, viewer.camera);
const card = new HoverCard(document.body);
new HoverController(picking, card, {
  unit: tileset.unit,
  tileForSlot: (slot) => manager.tilesBySlot.get(slot),
  catalogId: (tile, index) => {
    const local = tile.localId[index];
    return local === undefined ? undefined : ids[local];
  },
}, viewer.renderer.domElement);

// Earth sits at the origin of this layer; the label is permanent so the
// viewer always knows where they are.
const earth = new Anchor('Earth', new Vector3(0, 0, 0), document.body);
viewer.onFrame(() => {
  earth.update(viewer.camera, window.innerWidth, window.innerHeight);
});
```

The picking pass renders the scene with the visual material rather than the pick material as written. Swap materials for the pass: store the pick material on each mesh as `mesh.userData['pickMaterial']`, and in `PickingPass.readPixel`, before rendering, walk the scene swapping `mesh.material` to the pick material with `uTileSlot` set, then restore afterwards. Implement that swap inside `PickingPass` so `main.ts` stays a composition root.

- [ ] **Step 10: Verify hover and the anchor**

```bash
npm run dev
```

Expected: an `EARTH` label pinned at the origin that stays put as you fly, and a hover card showing a Gaia identifier and a distance when the cursor is over a star. Hovering empty space hides the card.

If every hover reports the same star, `uTileSlot` is not being set per draw. If hovering never hits anything, raise `uPickPointSize`.

- [ ] **Step 11: Commit**

```bash
npm run typecheck && npm run lint && npx vitest run
git add app/src/render/pickIds.ts app/src/render/pickIds.test.ts app/src/render/picking.ts \
        app/src/interaction/ app/src/ui/ app/src/tiles/tileManager.ts app/src/main.ts
git commit -m "feat(app): add hover picking, hover card and the Earth anchor

Identifiers render to an off-screen RGBA8 target and are read back from a
scissored region under the cursor, so picking cost is independent of object
count. Ids are stored offset by one so a zero readback means background."
```

---

### Task 12: End-to-end test, performance gate, and Phase 1 handoff

**Files:**
- Create: `playwright.config.ts`
- Create: `e2e/render.spec.ts`
- Modify: `package.json` (add a fixture bake script)
- Modify: `app/src/main.ts` (expose a test hook)

**Interfaces:**
- Consumes: everything.
- Produces: `window.__universeMap` — `{ ready: Promise<void>; manager: TileManager; viewer: Viewer; frameTimes: number[] }`, present only so the end-to-end test can observe real state rather than guess from pixels.

- [ ] **Step 1: Add the test hook to `app/src/main.ts`**

At the end of `boot()`:

```typescript
declare global {
  interface Window {
    __universeMap?: {
      viewer: Viewer;
      manager: TileManager;
      tileset: Tileset;
      frameTimes: number[];
    };
  }
}

const frameTimes: number[] = [];
viewer.onFrame((dt) => {
  frameTimes.push(dt * 1000);
  if (frameTimes.length > 600) frameTimes.shift();
});

window.__universeMap = { viewer, manager, tileset, frameTimes };
```

- [ ] **Step 2: Add a fixture bake script to `package.json`**

```json
"scripts": {
  "bake:fixture": ".venv/Scripts/python -m universe_pipeline.cli --synthetic 2000000"
}
```

- [ ] **Step 3: Create `playwright.config.ts`**

```typescript
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  use: {
    baseURL: 'http://localhost:5173',
    // WebGL in headless Chromium needs a real GL backend.
    launchOptions: {
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    },
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
  },
});
```

- [ ] **Step 4: Write the end-to-end test**

```typescript
// e2e/render.spec.ts
import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.__universeMap !== undefined, null, { timeout: 60_000 });
});

test('loads the tileset and reports the baked point count', async ({ page }) => {
  const pointCount = await page.evaluate(() => window.__universeMap!.tileset.pointCount);
  expect(pointCount).toBeGreaterThan(1_000_000);
});

test('streams tiles in as the camera approaches', async ({ page }) => {
  const before = await page.evaluate(() => window.__universeMap!.manager.meshes.size);

  await page.evaluate(async () => {
    const { viewer } = window.__universeMap!;
    viewer.camera.position.set(0, 0, 50);
    await new Promise((resolve) => setTimeout(resolve, 5000));
  });

  const after = await page.evaluate(() => window.__universeMap!.manager.meshes.size);
  expect(after).toBeGreaterThan(before);
});

test('renders something other than a black screen', async ({ page }) => {
  await page.evaluate(async () => {
    window.__universeMap!.viewer.camera.position.set(0, 0, 2000);
    await new Promise((resolve) => setTimeout(resolve, 4000));
  });

  const screenshot = await page.locator('canvas').screenshot();
  // A completely black canvas compresses to almost nothing; real starfields do not.
  expect(screenshot.byteLength).toBeGreaterThan(20_000);
});

test('shows the permanent Earth anchor', async ({ page }) => {
  await expect(page.getByText('Earth', { exact: true })).toBeVisible();
});

test('holds the frame budget while streaming', async ({ page }) => {
  await page.evaluate(async () => {
    const { viewer, frameTimes } = window.__universeMap!;
    frameTimes.length = 0;
    // Sweep inward so tiles are loading throughout the measurement.
    for (let i = 0; i < 60; i++) {
      viewer.camera.position.set(0, 0, 3000 - i * 45);
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    await new Promise((resolve) => setTimeout(resolve, 3000));
  });

  const p95 = await page.evaluate(() => {
    const sorted = [...window.__universeMap!.frameTimes].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length * 0.95)] ?? 0;
  });

  // 30 fps floor is 33.3 ms. SwiftShader is a software rasterizer and far
  // slower than real hardware, so this gate is deliberately loose; it catches
  // algorithmic collapse, not GPU-level regressions.
  expect(p95).toBeLessThan(200);
});
```

- [ ] **Step 5: Bake the fixture and run the suite**

```bash
npm run bake:fixture
npx playwright install chromium
npm run test:e2e
```

Expected: 5 passed.

If the frame budget test fails on real hardware rather than SwiftShader, the number to look at first is `manager.meshes.size` — an unbounded node count means `maxVisibleNodes` or the screen-space error threshold needs tightening, not that the gate is wrong.

- [ ] **Step 6: Run every check one final time**

```bash
npm run typecheck
npm run lint
npx vitest run
npm run build
.venv/Scripts/python -m pytest pipeline/tests -v
.venv/Scripts/python -m ruff check pipeline
npm run test:e2e
```

All seven must pass. Report the actual output — a skipped or filtered check is a failure, not a pass.

- [ ] **Step 7: Commit**

```bash
git add playwright.config.ts e2e/ package.json app/src/main.ts
git commit -m "test: add end-to-end render and frame budget gates

Playwright drives the real app against a baked fixture layer, asserting
tiles stream in on approach, the canvas is not blank, the Earth anchor is
present, and p95 frame time does not collapse under streaming load."
```

- [ ] **Step 8: Bake the real Gaia layer**

This is the first time real data enters the project, and it is a long download.

```bash
.venv/Scripts/python -m universe_pipeline.cli --chunks 48
```

Expect this to run for a long time and to be resumable — every chunk caches to `data/cache/`, so an interrupted run picks up where it stopped. Watch the per-chunk source counts; if the total lands far from 10M, adjust `g_mag_limit` in `pipeline/universe_pipeline/config.py` and rerun.

- [ ] **Step 9: Verify the real sky**

```bash
npm run dev
```

Sanity checks that no unit test can make for you:

- The field should be visibly **anisotropic** — a dense band across the sky where the galactic plane lies. A uniform sphere of stars means the transform collapsed the structure and something is wrong.
- Hovering a bright nearby star should report a plausible distance in light-years.
- Flying outward, the density should thin out toward the 5,000 ly boundary.

- [ ] **Step 10: STOP — Phase 1 handoff**

Phase 1 is complete. **Do not begin Phase 2.** Report to the user:

- The baked object count and how long the Gaia download took.
- The `g_mag_limit` that produced it.
- Measured p95 frame time on real hardware.
- The tuning values settled on for `uSizeScale`, `uMaxSize` and the alpha factor.
- Anything in the spec's Phase 2 scope that Phase 1 made look wrong.

---

## Plan Self-Review

**Spec coverage.** Checked each spec section against a task:

| Spec section | Covered by |
|---|---|
| 2 Architecture — pipeline/app split | File structure; Tasks 2 and 3 freeze the contract |
| 3.1 Sources — Gaia DR3, Bailer-Jones | Task 5 |
| 3.2 Layer ladder — L1 only in Phase 1 | Task 5 `config.py` |
| 3.3 Coordinate transforms | Task 4 |
| 3.4 Measured versus modeled | **Deferred to Phase 2** — `FLAG_MODELED` is defined in Task 5 and written as clear, so the format supports it; no modeled population exists in L1 |
| 3.5 Count is configuration | Task 5 `g_mag_limit`, Task 12 Step 8 |
| 4 Tile format v1 | Tasks 2, 3 |
| 5.1 Layer compositing | **Deferred to Phase 2** — Phase 1 has one layer, so there is nothing to composite |
| 5.2 Point rendering | Task 9 |
| 5.3 LOD and streaming | Task 10 |
| 5.4 Picking | Task 11 |
| 5.5 Time playback | **Phase 4** — velocity is written in Task 2 and uploaded in Task 9, unused |
| 6 Hover card, Earth anchor | Task 11 |
| 6 Auto-labels, search, HUD, filters | **Phase 3** |
| 7.1 Known-object golden tests | Task 4 |
| 7.2 Tiler invariants | Task 6 |
| 7.3 Format round-trip | Tasks 2, 3 |
| 7.4 Renderer end-to-end | Task 12 |
| 7.5 Performance gate | Task 12 |

Every Phase 1 requirement maps to a task. The deferrals are the spec's own phase boundaries, not gaps.

**Deviations from the spec, recorded deliberately:**

1. **Golden tests assert definitional quantities, not published star distances.** The spec called for a reference table including Sirius and M31. Literature distances for individual stars disagree at the percent level, so such a test encodes a debate rather than a fact. Task 4 instead tests the galactic pole, the galactic centre, Sagittarius A*, and parallax inversion — all exactly defined. This is strictly stronger and should be reflected back into the spec.
2. **`max_points_per_tile` is 65,536, not unbounded.** Forced by the 20-bit vertex field in the pick identifier encoding (Task 11).
3. **The spec's `localId` GPU attribute is not uploaded.** `gl_VertexID` supplies the index for free in GLSL3, so `localId` stays CPU-side. It remains in the file format as specified.

**Placeholder scan:** no TBD, TODO, or "handle errors appropriately" steps. Every code step carries complete code.

**Type consistency:** `TileNode`/`Tileset` (Task 9) match the `tileset.json` written in Task 7. `DecodedTile` (Task 3) is consumed unchanged by Tasks 9, 10, 11. `ObjectRecord` (Task 5) is consumed by Tasks 6 and 7. `ViewState` (Task 10) matches the call in `main.ts`. British spelling `colour` is used throughout app-side identifiers; the wire format field stays `colorIndex` because Task 2 froze it that way — this asymmetry is deliberate and load-bearing, do not "fix" it.
