# Rendering Fidelity Implementation Plan

> **For agentic workers:** Implement task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make LOD invisible and the galactic core viewable — fix the tile seams and the white-out that the Milky Way layer exposed.

**Architecture:** Two independent fixes. Flux compensation scales each tile's brightness by how many points its subsample stands in for, computed at traversal time from counts already in `tileset.json`. HDR tone mapping replaces the hard clip at white with an exposure that adapts to the scene, so a view spanning the galactic bulge and intergalactic space is legible at both ends.

**Tech Stack:** Unchanged. TypeScript + Three.js. **No pipeline change and no rebake.**

## Execution protocol

One subagent per task. **Do not spawn subagents, do not invoke `superpowers:*` skills, do not run `git`.** Tests are the only verification oracle. Stay inside the files each task names; the orchestrator commits. **Report within 20 minutes** — if a browser measurement is still running past that, report what you have and say what is outstanding.

## Global Constraints

- **No tile format change, no pipeline change, no rebake.** Everything needed is already in `tileset.json`.
- **No regressions.** 138 vitest, 120 pytest, 13 Playwright currently pass. The Playwright suite takes 8.7 minutes; run it **once**, at the end, not per task.
- **The honesty guarantees stay intact.** `uModeledDim` must keep dimming modeled points relative to measured ones after any exposure change.
- **Commits** carry a `Phase: fidelity` trailer; no attribution trailers.
- **Stop at the end of this plan.**

## The two defects

**1. Tile seams.** Measured at 350,000 ly: three or four concentric rounded-square brightness steps around the central glow. At 120,000 ly: a distinctly brighter square region with hard vertical edges. Cause: a node draws a random subsample of the points beneath it, so it emits proportionally less light, and neighbouring nodes at different depths differ in brightness by their subsample ratio. Dropping 3.6M points to 590k loses 84% of the light.

**2. The core whites out.** At 12,000 ly from the galactic centre: mean luminance 205 of 255 with **99.99998% of pixels lit** — a solid white rectangle. Additive blending accumulates without bound while the output clips at 1.0, so there is no rolloff at all.

These are different problems. Exposure cannot fix seams, because a seam is a *spatial* discontinuity and exposure is global — auto-exposure would pick a middle value and leave the edges exactly where they are. Flux compensation cannot fix the white-out, because that is genuine dynamic range. Both are needed, and flux comes first: exposure adapting to an incorrect signal would confidently expose the wrong thing.

## The key realisation: no rebake

Every node in `tileset.json` already carries `pointCount` (what it draws) and `totalPointCount` (what lies at and beneath it). Verified on the live milky-way tileset: root is `pointCount 65536, totalPointCount 4002013`.

So the weight is computable in the browser. It is also **dynamic**, which a baked constant could never be: a node's points only stand in for a descendant when that descendant is not itself being drawn.

```
represented(node) = node.pointCount + sum(child.totalPointCount for unselected children)
fluxWeight(node)  = represented(node) / node.pointCount
```

A fully-refined node weighs 1. A leaf drawn alone weighs `totalPointCount / pointCount`. Partial selection falls out correctly.

## Correction after Task 2: the seams are density, not flux

Task 2 landed the flux weight, verified it correct — the sum of `pointCount × fluxWeight` equals the root's 4,002,013 at every distance — and measured **no change to the seams at all**. Radial profiles at 350,000 ly match to four decimals; the bright square at 120,000 ly has an in/out ratio of 8.317 before and 8.340 after.

**The premise above was wrong.** "Dropping 3.6M points to 590k loses 84% of the light" was measured on the *stellar* layer. The milky-way tileset has 269 nodes against a 199-node budget, so 86% of its points are already drawn at 10k–120k ly and the median flux weight is exactly 1.0.

Where headroom exists, the clamps absorb it. At 350,000 ly a 63% coverage should brighten the frame 1.58×; measured **1.0005×**, three orders of magnitude short. Every point is pinned at `clamp(brightness * uAlphaScale, 0.02, 1.0)` and `clamp(… , 1.0, 8.0)`, where multiplying brightness by 12 changes nothing.

So a seam is a **point-density** discontinuity. With alpha floored, a pixel's brightness is simply how many drawn points land on it, and tiles at different depths deposit different densities. No per-tile scalar can compensate that while the floor holds.

**Those floors are a workaround for the absence of HDR.** They exist so distant points stay visible in a pipeline that clips at 1.0 — an earlier experiment removing the floor erased the galaxy at 350,000 ly. Once tone mapping carries the range, the floors are no longer needed and are actively harmful: they are what stops the flux weight from acting.

That makes Tasks 3 and 4 a precondition rather than a parallel fix, and adds Task 4b below. The flux weight stays: it is correct, and it is what makes removing the floors safe.

## File Structure

| File | Responsibility |
|---|---|
| `app/src/tiles/traversal.ts` | *(modify)* return flux weight alongside each selected node |
| `app/src/tiles/tileManager.ts` | *(modify)* push the weight onto each tile's material |
| `app/src/render/pointMaterial.ts` | *(modify)* `uFluxWeight` uniform, applied to brightness |
| `app/src/render/autoExposure.ts` | Pure exposure maths: target, adaptation, clamping |
| `app/src/core/viewer.ts` | *(modify)* tone-mapping output pass and the exposure loop |

---

### Task 1: Compute the flux weight during traversal

**Files:** modify `app/src/tiles/traversal.ts`, `app/src/tiles/traversal.test.ts`

**Interfaces:**
- `interface SelectedNode { node: TileNode; fluxWeight: number }`
- `selectNodes(root, view, threshold, maxNodes): TileNode[]` — **unchanged**, so existing callers keep working
- `selectNodesWithFlux(root, view, threshold, maxNodes): SelectedNode[]` — new; `selectNodes` becomes a thin wrapper over it

Computing the weight needs the selection set, so it must happen after selection completes, not during. Build the selected list first, then walk it once with a `Set` of selected paths to find which children were left out.

- [ ] **Step 1: Write the failing tests**

```typescript
// append to app/src/tiles/traversal.test.ts
import { selectNodesWithFlux } from './traversal.js';

const withCounts = (
  path: string,
  min: number[],
  max: number[],
  error: number,
  pointCount: number,
  totalPointCount: number,
  children: TileNode[] = [],
): TileNode => ({
  path,
  boundingBox: { min, max },
  geometricError: error,
  pointCount,
  totalPointCount,
  children,
});

describe('selectNodesWithFlux', () => {
  it('weighs a lone leaf by how many points it stands in for', () => {
    const leaf = withCounts('r', [-1, -1, -1], [1, 1, 1], 0.0001, 1000, 8000);
    const [selected] = selectNodesWithFlux(leaf, view, 16, 100);
    expect(selected!.fluxWeight).toBeCloseTo(8);
  });

  it('weighs a fully refined parent as 1', () => {
    // Parent draws 100 of 900; its two children hold the other 800 and are
    // both selected, so the parent stands in for nothing beyond itself.
    const a = withCounts('r0', [-1, -1, -1], [1, 1, 1], 1e6, 400, 400);
    const b = withCounts('r1', [-1, -1, -1], [1, 1, 1], 1e6, 400, 400);
    const root = withCounts('r', [-1, -1, -1], [1, 1, 1], 1e9, 100, 900, [a, b]);

    const selected = selectNodesWithFlux(root, view, 1, 100);
    const parent = selected.find((s) => s.node.path === 'r')!;
    expect(parent.fluxWeight).toBeCloseTo(1);
  });

  it('counts only the children that were left out', () => {
    // Only the near child is selected; the far one is not, so the parent
    // carries its 700 points.
    const near = withCounts('r0', [-1, -1, -1], [1, 1, 1], 1e6, 100, 100);
    const far = withCounts('r1', [1e9, 1e9, 1e9], [1e9 + 1, 1e9 + 1, 1e9 + 1], 1e-9, 700, 700);
    const root = withCounts('r', [-1, -1, -1], [1e9 + 1, 1e9 + 1, 1e9 + 1], 1e9, 100, 900, [near, far]);

    const selected = selectNodesWithFlux(root, view, 1, 100);
    const paths = selected.map((s) => s.node.path);
    expect(paths).toContain('r');
    expect(paths).not.toContain('r1');

    const parent = selected.find((s) => s.node.path === 'r')!;
    // 100 of its own plus the 700 it now represents, over 100 drawn.
    expect(parent.fluxWeight).toBeCloseTo(8);
  });

  it('never returns a weight below 1', () => {
    const leaf = withCounts('r', [-1, -1, -1], [1, 1, 1], 0.0001, 500, 500);
    expect(selectNodesWithFlux(leaf, view, 16, 100)[0]!.fluxWeight).toBeGreaterThanOrEqual(1);
  });

  it('survives a node that draws no points', () => {
    const leaf = withCounts('r', [-1, -1, -1], [1, 1, 1], 0.0001, 0, 0);
    const [selected] = selectNodesWithFlux(leaf, view, 16, 100);
    expect(Number.isFinite(selected!.fluxWeight)).toBe(true);
  });

  it('conserves total represented points across the selection', () => {
    // The sum of drawn points times their weights must equal the whole tree.
    const a = withCounts('r0', [-1, -1, -1], [1, 1, 1], 1e6, 400, 400);
    const b = withCounts('r1', [2e9, 2e9, 2e9], [2e9 + 1, 2e9 + 1, 2e9 + 1], 1e-9, 400, 400);
    const root = withCounts('r', [-1, -1, -1], [2e9 + 1, 2e9 + 1, 2e9 + 1], 1e9, 100, 900, [a, b]);

    const selected = selectNodesWithFlux(root, view, 1, 100);
    const represented = selected.reduce((sum, s) => sum + s.node.pointCount * s.fluxWeight, 0);
    expect(represented).toBeCloseTo(900);
  });

  it('agrees with selectNodes on which nodes are chosen', () => {
    const child = withCounts('r0', [-1, -1, -1], [1, 1, 1], 0.0001, 10, 10);
    const root = withCounts('r', [-1, -1, -1], [1, 1, 1], 1000, 10, 20, [child]);

    expect(selectNodesWithFlux(root, view, 16, 100).map((s) => s.node.path)).toEqual(
      selectNodes(root, view, 16, 100).map((n) => n.path),
    );
  });
});
```

The conservation test is the one that matters. If drawn points times weight does not sum to the tree's total, the scene's total emitted light changes with camera distance — which is exactly the bug.

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run app/src/tiles/traversal.test.ts`
Expected: cannot resolve `selectNodesWithFlux`.

- [ ] **Step 3: Implement it**

Rename the existing selection body to `selectNodesWithFlux`, and after the loop that fills `selected`, compute weights:

```typescript
export interface SelectedNode {
  node: TileNode;
  fluxWeight: number;
}

export function selectNodesWithFlux(
  root: TileNode,
  view: ViewState,
  threshold: number,
  maxNodes: number,
): SelectedNode[] {
  const selected: TileNode[] = [];
  // ... existing traversal, unchanged, filling `selected` ...

  const chosen = new Set(selected.map((node) => node.path));
  return selected.map((node) => {
    let represented = node.pointCount;
    for (const child of node.children) {
      if (!chosen.has(child.path)) represented += child.totalPointCount;
    }
    const drawn = node.pointCount;
    return { node, fluxWeight: drawn > 0 ? Math.max(represented / drawn, 1) : 1 };
  });
}

export function selectNodes(
  root: TileNode,
  view: ViewState,
  threshold: number,
  maxNodes: number,
): TileNode[] {
  return selectNodesWithFlux(root, view, threshold, maxNodes).map((s) => s.node);
}
```

An unselected child's *own* descendants are already inside its `totalPointCount`, so no recursion is needed.

- [ ] **Step 4: Run and confirm all pass**

Run: `npx vitest run app/src/tiles/traversal.test.ts`
Expected: the existing traversal tests plus 7 new, all green.

- [ ] **Step 5: Verify and commit**

```
npm run typecheck && npm run lint && npx vitest run
```

```bash
git add app/src/tiles/traversal.ts app/src/tiles/traversal.test.ts
git commit -m "feat(app): compute a per-node flux weight during traversal"
```

---

### Task 2: Apply the flux weight when drawing

**Files:** modify `app/src/render/pointMaterial.ts`, `app/src/tiles/tileManager.ts`, `app/src/layers/layerRenderer.ts`

**Interfaces:**
- `pointMaterial` gains `uFluxWeight` (default 1)
- `TileManager.update` uses `selectNodesWithFlux` and writes each node's weight onto that tile's cloned material

The weight scales **brightness**, which drives both alpha and point size — a subsample standing in for eight points should look like eight points' worth of light, not eight times the alpha of one.

- [ ] **Step 1: Add the uniform to the vertex shader**

Declare `uniform float uFluxWeight;` and apply it to brightness before size and alpha are derived:

```glsl
  float brightness = pow(10.0, -0.4 * apparentMag) * uFluxWeight;
```

Add `uFluxWeight: { value: 1 }` to the uniforms block.

- [ ] **Step 2: Push the weight per tile in `TileManager.update`**

Switch the selection call to `selectNodesWithFlux`, keep a `Map<string, number>` of path to weight for the current frame, and after the visibility loop set the uniform on each visible mesh's material. Follow the existing per-mesh uniform pattern — the material is cloned per tile, so writing the base material alone will not reach live tiles.

- [ ] **Step 3: Write the failing test**

```typescript
// append to app/src/tiles/tileManager.test.ts
describe('flux weighting', () => {
  it('a coarse selection represents the same total light as a fine one', () => {
    // Two selections of the same tree must carry the same represented points,
    // or the scene's brightness changes with camera distance.
    const child = { path: 'r0', boundingBox: { min: [-1, -1, -1], max: [1, 1, 1] },
      geometricError: 1e-6, pointCount: 800, totalPointCount: 800, children: [] };
    const root = { path: 'r', boundingBox: { min: [-1, -1, -1], max: [1, 1, 1] },
      geometricError: 1e9, pointCount: 100, totalPointCount: 900, children: [child] };

    const near = { position: { x: 0, y: 0, z: 0 }, screenHeight: 1080, fovRadians: 1 };
    const far = { position: { x: 1e12, y: 0, z: 0 }, screenHeight: 1080, fovRadians: 1 };

    const total = (v: typeof near) =>
      selectNodesWithFlux(root, v, 8, 100).reduce(
        (sum, s) => sum + s.node.pointCount * s.fluxWeight, 0);

    expect(total(near)).toBeCloseTo(900);
    expect(total(far)).toBeCloseTo(900);
  });
});
```

- [ ] **Step 4: Run, then verify in the browser**

`npx vitest run` must stay green. Then use system Chrome via Playwright (`channel: 'chrome'`, `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`) against `npm run dev` and measure mean luminance at 10,000 / 30,000 / 120,000 / 350,000 ly **before and after** this change.

The seams were worst at 350,000 ly (concentric rounded-square steps) and at 120,000 ly (a bright square with hard vertical edges). Report whether they are gone, reduced, or unchanged, with screenshots. **If they are unchanged, say so** — the weight may be correct while something else drives the steps, and a wrong diagnosis is worth knowing.

- [ ] **Step 5: Commit**

```bash
git add app/src/render/pointMaterial.ts app/src/tiles/tileManager.ts app/src/tiles/tileManager.test.ts
git commit -m "feat(app): scale tile brightness by its flux weight"
```

---

### Task 3: Tone map instead of clipping

**Files:** modify `app/src/core/viewer.ts`

**Interfaces:**
- `Viewer` gains `setExposure(value: number): void`, `getExposure(): number`
- Tone mapping is ACES Filmic; exposure is fixed in this task and becomes automatic in Task 4

The composer's internal render target is already half-float in this Three version, so additive accumulation above 1.0 survives *inside* the chain — the clip happens only when the final pass writes to the canvas. That is why the core saturates: the data is there, nothing maps it down.

Add `OutputPass` at the end of the composer chain and set `renderer.toneMapping = ACESFilmicToneMapping`. `OutputPass` applies tone mapping and the output colour space in one step.

**One trap.** `viewer.ts` currently sets `outputColorSpace = LinearSRGBColorSpace` to undo a double sRGB encode: `UnrealBloomPass` blits through a `MeshBasicMaterial` that encodes on output, while the point shader already emits display-space colour. `OutputPass` performs the encode itself, so leaving the renderer in linear output would now under-encode. Verify which combination gives a frame matching the current one at exposure 1.0 with tone mapping off, and say what you found — do not assume.

- [ ] **Step 1: Confirm the composer target is float, and record the baseline**

Before changing anything, measure mean luminance and saturated-pixel fraction at 12,000 ly from the galactic centre (the white-out) and at 30,000 ly and 350,000 ly. Report the composer's `renderTarget1.texture.type`. If it is `UnsignedByteType` rather than `HalfFloatType`, say so — the composer must be constructed with an explicit half-float target and the plan's premise is wrong.

- [ ] **Step 2: Add tone mapping**

```typescript
import { ACESFilmicToneMapping, ... } from 'three';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// in the constructor, after the bloom pass:
this.renderer.toneMapping = ACESFilmicToneMapping;
this.renderer.toneMappingExposure = 1;
this.composer.addPass(new OutputPass());
```

```typescript
setExposure(value: number): void {
  this.renderer.toneMappingExposure = Math.max(value, 0);
}

getExposure(): number {
  return this.renderer.toneMappingExposure;
}
```

- [ ] **Step 3: Sweep exposure and report**

At 12,000 ly from the galactic centre, sweep exposure over 0.05, 0.1, 0.25, 0.5, 1, 2 and report mean luminance and saturated fraction for each. Do the same at 350,000 ly. The point is to establish the range Task 4 must cover: the two ends of the map should need wildly different exposures, and that difference is the argument for making it automatic.

Report the exposure at which the core stops being a solid white rectangle and structure becomes visible.

- [ ] **Step 4: Confirm the honesty guarantee survives**

`uModeledDim` must still dim modeled points relative to measured ones after tone mapping. Measure mean luminance at 50,000 ly with `uModeledDim` at 1.0 and at 0.45 under the new pipeline, and report the ratio. Tone mapping is non-linear, so the ratio will not be exactly 0.45 — but it must remain clearly below 1, or the honesty signal has been flattened away.

- [ ] **Step 5: Commit**

```bash
npm run typecheck && npm run lint && npx vitest run
git add app/src/core/viewer.ts
git commit -m "feat(app): tone map the composed frame instead of clipping it"
```

---

### Task 4: Adapt exposure to the scene

**Files:** create `app/src/render/autoExposure.ts`, `app/src/render/autoExposure.test.ts`; modify `app/src/core/viewer.ts`

**Interfaces:**
- `TARGET_LUMINANCE = 0.18` — the standard mid-grey photographic target
- `exposureForLuminance(averageLuminance: number, target?: number): number`
- `adaptExposure(current: number, desired: number, dtSeconds: number, halfLifeSeconds?: number): number`
- `class ExposureMeter` — `constructor(renderer, size?)`, `measure(target: WebGLRenderTarget): number`, `dispose(): void`
- `Viewer` gains `setAutoExposure(enabled: boolean): void`, `getAutoExposure(): boolean`

The maths is pure and tested; the GPU sampling is verified in the browser.

**Adaptation must be smooth.** A camera's eye adaptation takes a moment; snapping exposure per frame makes the whole field pulse as tiles stream in. Use an exponential approach with a half-life, framed so it is frame-rate independent — at 4 fps under software rendering and 120 fps on real hardware it must feel the same.

- [ ] **Step 1: Write the failing tests**

```typescript
// app/src/render/autoExposure.test.ts
import { describe, expect, it } from 'vitest';
import { TARGET_LUMINANCE, adaptExposure, exposureForLuminance } from './autoExposure.js';

describe('exposureForLuminance', () => {
  it('leaves an already correct scene alone', () => {
    expect(exposureForLuminance(TARGET_LUMINANCE)).toBeCloseTo(1);
  });

  it('dims a scene that is too bright', () => {
    expect(exposureForLuminance(TARGET_LUMINANCE * 4)).toBeCloseTo(0.25);
  });

  it('brightens a scene that is too dark', () => {
    expect(exposureForLuminance(TARGET_LUMINANCE / 4)).toBeCloseTo(4);
  });

  it('does not divide by zero on a black frame', () => {
    const e = exposureForLuminance(0);
    expect(Number.isFinite(e)).toBe(true);
    expect(e).toBeGreaterThan(0);
  });

  it('clamps rather than returning an absurd exposure for a near-black frame', () => {
    expect(exposureForLuminance(1e-9)).toBeLessThanOrEqual(64);
  });
});

describe('adaptExposure', () => {
  it('moves toward the desired value', () => {
    const next = adaptExposure(1, 4, 0.1);
    expect(next).toBeGreaterThan(1);
    expect(next).toBeLessThan(4);
  });

  it('covers half the gap in one half-life', () => {
    expect(adaptExposure(0, 1, 0.5, 0.5)).toBeCloseTo(0.5, 2);
  });

  it('is frame rate independent', () => {
    // One 0.4 s step must land where four 0.1 s steps do.
    let stepped = 1;
    for (let i = 0; i < 4; i++) stepped = adaptExposure(stepped, 8, 0.1, 0.5);
    expect(adaptExposure(1, 8, 0.4, 0.5)).toBeCloseTo(stepped, 4);
  });

  it('converges rather than overshooting', () => {
    let e = 1;
    for (let i = 0; i < 200; i++) e = adaptExposure(e, 5, 0.05);
    expect(e).toBeCloseTo(5, 2);
  });

  it('handles a zero or negative timestep without moving backwards', () => {
    expect(adaptExposure(2, 8, 0)).toBeCloseTo(2);
    expect(adaptExposure(2, 8, -1)).toBeCloseTo(2);
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run app/src/render/autoExposure.test.ts`
Expected: cannot resolve `./autoExposure.js`.

- [ ] **Step 3: Implement the pure maths**

```typescript
export const TARGET_LUMINANCE = 0.18;
const MIN_EXPOSURE = 1 / 64;
const MAX_EXPOSURE = 64;
const DEFAULT_HALF_LIFE_SECONDS = 0.6;

export function exposureForLuminance(
  averageLuminance: number,
  target = TARGET_LUMINANCE,
): number {
  if (!(averageLuminance > 0)) return MAX_EXPOSURE;
  return Math.min(Math.max(target / averageLuminance, MIN_EXPOSURE), MAX_EXPOSURE);
}

export function adaptExposure(
  current: number,
  desired: number,
  dtSeconds: number,
  halfLifeSeconds = DEFAULT_HALF_LIFE_SECONDS,
): number {
  if (!(dtSeconds > 0) || !(halfLifeSeconds > 0)) return current;
  // Frame-rate independent: the fraction of the gap closed depends on elapsed
  // time, not on how many frames it took.
  const k = 1 - Math.pow(0.5, dtSeconds / halfLifeSeconds);
  return current + (desired - current) * k;
}
```

- [ ] **Step 4: Implement `ExposureMeter` and wire it into the frame loop**

Render the composer's output target into a small (64x64) target, read it back with `readRenderTargetPixels`, and average the luminance. Read back **at most a few times a second**, not every frame — `readRenderTargetPixels` stalls the pipeline, and exposure adapting over hundreds of milliseconds does not need per-frame data.

In `Viewer.tick`, when auto-exposure is on: measure periodically, compute `exposureForLuminance`, then `adaptExposure` toward it using the real frame delta, and apply with `setExposure`.

- [ ] **Step 5: Verify in the browser**

Fly the sweep and report, at each of 12,000 ly from the galactic centre, 30,000 / 120,000 / 350,000 ly, and 1 Mly:

- the exposure auto-exposure settles on
- mean luminance and saturated fraction after settling
- how long settling takes in seconds

Then check the two things that would make this worse than fixed exposure:

- **Pulsing.** Hold the camera still for 30 s in a dense region while tiles stream in, and report the peak-to-peak variation in exposure once settled. It should be small; a visibly breathing field is a regression even if the average is right.
- **Overshoot on a hard cut.** Jump from 12,000 ly to 1 Mly in one frame and report whether exposure converges monotonically or oscillates.

- [ ] **Step 6: Commit**

```bash
npm run typecheck && npm run lint && npx vitest run
git add app/src/render/autoExposure.ts app/src/render/autoExposure.test.ts app/src/core/viewer.ts
git commit -m "feat(app): adapt exposure to scene luminance"
```

---

### Task 4b: Remove the brightness floors now that exposure carries the range

**Files:** modify `app/src/render/pointMaterial.ts`

The `0.02` alpha floor and `1.0` point-size floor exist because the pipeline clipped at white and distant points would otherwise vanish. With tone mapping and adaptive exposure in place, they are no longer load-bearing — and they are what pins every distant point to the same brightness regardless of how many points it stands in for, which is what makes LOD boundaries visible.

**This task only makes sense if Tasks 3 and 4 succeeded.** If exposure is not adapting, lowering the floors will erase the distant galaxy exactly as the earlier experiment did. Verify auto-exposure is working before starting, and say so if it is not.

- [ ] **Step 1: Record the baseline**

Measure mean luminance, lit fraction and saturated fraction at 30,000 / 120,000 / 350,000 ly and 1 Mly, and capture the seam metrics: the radial luminance profile at 350,000 ly in 30 px bins, and the in-box/out-of-box ratio for the bright square at 120,000 ly (x 530–1020, y 160–580). Those two numbers are how you will know whether this worked.

- [ ] **Step 2: Sweep the floors downward**

Try alpha floors of 0.02 (current), 0.005, 0.001 and 0.0, and size floors of 1.0 and 0.0, and report the seam metrics and luminance for each combination. Expect a tension: lower floors let the flux weight act, but may make the far view too dim for exposure to recover.

- [ ] **Step 3: Choose values by evidence**

Pick the combination where the 120,000 ly box ratio moves meaningfully toward 1.0 and the 350,000 ly radial profile loses its steps, **without** the galaxy disappearing at 1 Mly. Report the numbers behind the choice.

If no combination achieves both, say so plainly and report the trade-off curve. A partial improvement honestly described is a fine outcome; a claim that the seams are gone when they are merely dimmer is not.

- [ ] **Step 4: Confirm the honesty guarantee still holds**

Measure mean luminance at 50,000 ly with `uModeledDim` at 1.0 and 0.45 under the new floors and report the ratio. Modeled points must remain visibly dimmer than measured ones.

- [ ] **Step 5: Commit**

```bash
npm run typecheck && npm run lint && npx vitest run
git add app/src/render/pointMaterial.ts
git commit -m "fix(app): lower the brightness floors so flux compensation can act"
```

---

### Task 5: Verify the whole map and hand off

**Files:** modify `e2e/render.spec.ts`

- [ ] **Step 0: Re-validate the inherited luminance thresholds**

`e2e/render.spec.ts` asserts `mean > 1.5` and `litFraction > 0.03` at 50,000 ly. Those constants were measured against the renderer as it stood **before** flux compensation and before the floors moved, and the agent that wrote them flagged the exposure explicitly. Task 2 raised brightness, which makes them safer; Task 4b lowers the floors, which pushes the other way.

Measure the live values first and report them against the thresholds. If the margin has collapsed, widen the threshold **downward only if the view is genuinely still legible** — and say so. Do not raise a threshold to make a dimmer view pass; that converts a regression detector into a rubber stamp.

- [ ] **Step 1: Add two tests**

```typescript
test('the galactic core is legible from inside it', async ({ page }) => {
  const m = await page.evaluate(async () => {
    const u = window.__universeMap!;
    // 12,000 ly from the galactic centre, which sits at +X.
    u.viewer.camera.position.set(26670 - 12000, 0, 0);
    await new Promise((r) => setTimeout(r, 12000));
    return measureLuminanceInPage();
  });
  // It read 205 of 255 with 99.99998% of pixels lit before tone mapping.
  expect(m.saturated).toBeLessThan(0.2);
});

test('brightness does not jump when the level of detail changes', async ({ page }) => {
  const readings = await page.evaluate(async () => {
    const u = window.__universeMap!;
    const out: { d: number; mean: number }[] = [];
    for (const d of [100000, 150000, 220000, 320000]) {
      u.viewer.camera.position.set(0, 0, d);
      await new Promise((r) => setTimeout(r, 8000));
      out.push({ d, mean: measureLuminanceInPage().mean });
    }
    return out;
  });
  // Brightness should fall smoothly with distance, not step at LOD boundaries.
  for (let i = 1; i < readings.length; i++) {
    const ratio = readings[i - 1]!.mean / Math.max(readings[i]!.mean, 1e-6);
    expect(ratio).toBeLessThan(6);
  }
});
```

Reuse the `measureLuminance` helper already in the spec rather than adding another; adapt the names to whatever it exports. The second test's bound is a starting point — measure the real ratios first and set it with headroom over what you observe, reporting both.

- [ ] **Step 2: Run everything once**

```
npx vitest run
npm run typecheck && npm run lint && npm run build
.venv/Scripts/python -m pytest pipeline/tests -q
npx playwright test
```

The Playwright suite takes about 9 minutes. Run it **once**. If a test fails, report it rather than re-running to see whether it was flaky.

- [ ] **Step 3: Look at it and report**

`npm run dev`, fly from inside the galactic bulge out to 300 Mly. Report:

- whether the tile seams are gone at 120,000 and 350,000 ly, where they were worst
- whether the core is viewable from inside
- whether exposure changes feel natural or intrusive
- whether the modeled population is still visibly dimmer than the measured clusters

- [ ] **Step 4: STOP and hand off.** Report what improved, what did not, and anything the fix made worse.

---

## Plan Self-Review

**Coverage.** Seams — Tasks 1 and 2. White-out — Tasks 3 and 4. Both verified together in Task 5.

**Deliberate decisions:**

1. **No rebake.** `pointCount` and `totalPointCount` are already in every tileset node, so the weight is computed in the browser. This also makes it correct under partial selection, which a baked per-tile constant could not be — a node's points only stand in for a descendant that is not itself drawn.
2. **`selectNodes` keeps its signature.** `selectNodesWithFlux` is the new entry point and `selectNodes` wraps it, so existing callers and their tests are untouched.
3. **Flux before exposure.** Auto-exposure adapting to an uncorrected signal would expose the wrong thing confidently.
4. **Readback is throttled, not per-frame.** `readRenderTargetPixels` stalls the pipeline; exposure adapting over hundreds of milliseconds does not need per-frame sampling.

**Risk the plan cannot resolve in advance:** Task 3 Step 1 exists because the whole tone-mapping approach rests on the composer's target already being half-float. If it is `UnsignedByteType`, the frame is clipped before any pass can act, and the target must be constructed explicitly. That is why the first step measures rather than assumes.

**Placeholder scan:** none. Task 5's second test carries a starting bound with an explicit instruction to measure and set it with headroom, which is a stated calibration step, not a stub.

**Type consistency:** `SelectedNode` (Task 1) is consumed by Task 2. `exposureForLuminance` and `adaptExposure` (Task 4) match their call sites in `Viewer.tick`. `setExposure` is introduced in Task 3 and used by Task 4.
