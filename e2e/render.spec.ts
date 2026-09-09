import { expect, test, type Page } from '@playwright/test';
// Importing the app's own global declaration keeps this spec from drifting
// from the hook it drives.
// Type-only: importing it for its side effects would run boot() in the Node
// test process, where there is no document.
import type {} from '../app/src/main.js';

const meshCount = (page: Page): Promise<number> =>
  page.evaluate(() => window.__universeMap!.manager.meshes.size);

// The direct signal is inFlightCount: a plateau in meshes.size can just be
// eight slow fetches that have not landed yet.
async function waitForIdleLoader(page: Page): Promise<number> {
  let previous = -1;
  for (let i = 0; i < 60; i++) {
    const state = await page.evaluate(() => ({
      loaded: window.__universeMap!.manager.meshes.size,
      inFlight: window.__universeMap!.manager.inFlightCount,
    }));
    if (state.loaded > 0 && state.inFlight === 0 && state.loaded === previous) return state.loaded;
    previous = state.inFlight === 0 ? state.loaded : -1;
    await page.waitForTimeout(1000);
  }
  throw new Error(`loader never went idle (last ${previous})`);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.__universeMap !== undefined, null, { timeout: 60_000 });
  await page.waitForFunction(() => window.__universeMap!.manager.meshes.size > 0, null, {
    timeout: 60_000,
  });
});

test('loads the tileset and reports the baked point count', async ({ page }) => {
  const pointCount = await page.evaluate(() => window.__universeMap!.tileset.pointCount);
  expect(pointCount).toBeGreaterThan(1_000_000);
});

test('streams tiles in as the camera approaches', async ({ page }) => {
  const before = await waitForIdleLoader(page);

  await page.evaluate(() => {
    window.__universeMap!.viewer.camera.position.set(0, 0, 50);
  });
  await page.waitForTimeout(10_000);

  const after = await meshCount(page);
  console.log(`tiles loaded: ${before} at z=3000, ${after} at z=50`);
  expect(after).toBeGreaterThan(before);
});

test('renders something other than a black screen', async ({ page }) => {
  await waitForIdleLoader(page);
  const canvas = page.locator('canvas');

  const withStars = await canvas.screenshot();
  await page.evaluate(() => {
    window.__universeMap!.manager.group.visible = false;
  });
  await page.waitForTimeout(1500);
  const withoutStars = await canvas.screenshot();

  console.log(`png bytes: stars ${withStars.byteLength}, blank ${withoutStars.byteLength}`);
  // A differential rather than an absolute byte count: the blank frame is the
  // same canvas with only the point cloud hidden, so it calibrates what "black"
  // compresses to on this machine instead of hardcoding a guess. Measured ratio
  // is ~339x, so 50x still rejects a frame carrying only a few bright blobs.
  expect(withStars.byteLength).toBeGreaterThan(withoutStars.byteLength * 50);
});

test('shows the permanent Earth anchor', async ({ page }) => {
  await expect(page.locator('[data-anchor="Earth"]')).toBeVisible();
});

test('identifies the star under the cursor, not merely some star', async ({ page }) => {
  await waitForIdleLoader(page);
  await page.evaluate(() => window.__universeMap!.identifiersReady);

  const probe = await page.evaluate(() => {
    const { viewer, manager, picking, hover } = window.__universeMap!;
    const width = window.innerWidth;
    const height = window.innerHeight;
    // Column-major, the layout three uses for Matrix4.elements.
    const apply = (m: number[], v: number[]): number[] =>
      [0, 1, 2, 3].map((r) => m[r]! * v[0]! + m[4 + r]! * v[1]! + m[8 + r]! * v[2]! + m[12 + r]! * v[3]!);

    for (let ny = 0.2; ny <= 0.81; ny += 0.2) {
      for (let nx = 0.2; nx <= 0.81; nx += 0.2) {
        const x = Math.round(nx * width);
        const y = Math.round(ny * height);
        const id = picking.pickAt(x, y);
        if (!id) continue;
        const entry = manager.tilesBySlot.get(id.tileSlot);
        if (!entry) continue;

        const { tile } = entry;
        const world = [0, 1, 2].map(
          (a) =>
            tile.bboxMin[a]! +
            (tile.positionQuantized[id.vertexIndex * 3 + a]! / 65535) *
              (tile.bboxMax[a]! - tile.bboxMin[a]!),
        );
        // pickAt just rendered the scene, so the camera matrices are current.
        const clip = apply(
          viewer.camera.projectionMatrix.elements,
          apply(viewer.camera.matrixWorldInverse.elements, [...world, 1]),
        );
        hover.pick(x, y);
        return {
          x,
          y,
          screenX: (clip[0]! / clip[3]! / 2 + 0.5) * width,
          screenY: (-clip[1]! / clip[3]! / 2 + 0.5) * height,
          distance: Math.hypot(world[0]!, world[1]!, world[2]!),
        };
      }
    }
    return null;
  });
  expect(probe).not.toBeNull();

  const offset = Math.hypot(probe!.screenX - probe!.x, probe!.screenY - probe!.y);
  console.log(`probe ${JSON.stringify(probe)} offset ${offset.toFixed(2)}px`);
  // Without this the test only proves that some star somewhere was reported:
  // every point in the layer is inside 5000 ly, so a slot-aliasing bug or a
  // dropped bbox offset would still produce a plausible-looking card. The pick
  // point is 10 CSS px wide and the scissor adds 2, so the hit can sit a few
  // pixels off the probe, but not tens.
  expect(offset).toBeLessThan(24);

  const text = await page.locator('[data-hover-card]').textContent();
  console.log(`hover card:\n${text}`);
  const lines = (text ?? '').split('\n');
  expect(lines[0]).toMatch(/^Gaia DR3 \d+$/);

  const reported = /^([\d.]+) ly from Earth$/.exec(lines[2] ?? '');
  expect(reported).not.toBeNull();
  // The card must report the distance to the point that was actually picked.
  expect(Number(reported![1])).toBeCloseTo(probe!.distance, 1);
  // L1 runs to max_radius_ly = 5000 (pipeline/universe_pipeline/config.py).
  expect(probe!.distance).toBeLessThan(5000);
});

test('frame cost scales with the points drawn and streaming converges', async ({ page }) => {
  await waitForIdleLoader(page);

  // Sampled inside the sweep and returned before anything idles, so no
  // post-settle frames dilute the median.
  const streaming = await page.evaluate(async () => {
    const { viewer, frameTimes } = window.__universeMap!;
    frameTimes.length = 0;
    for (let i = 0; i < 60; i++) {
      viewer.camera.position.set(0, 0, 3000 - i * 45);
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    const sorted = [...frameTimes].sort((a, b) => a - b);
    return {
      samples: sorted.length,
      median: sorted[Math.floor(sorted.length / 2)] ?? 0,
      p95: sorted[Math.floor(sorted.length * 0.95)] ?? 0,
      max: sorted[sorted.length - 1] ?? 0,
    };
  });

  await page.evaluate(() => {
    window.__universeMap!.viewer.camera.position.set(0, 0, 50);
  });
  await waitForIdleLoader(page);

  const settled = await page.evaluate(async () => {
    const { manager } = window.__universeMap!;
    const before = manager.meshes.size;
    let maxInFlight = 0;
    for (let i = 0; i < 25; i++) {
      maxInFlight = Math.max(maxInFlight, manager.inFlightCount);
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    return { before, after: manager.meshes.size, maxInFlight };
  });

  // Both states are sampled from the same fully-populated cache, alternating
  // three times, so machine drift between the two lands on both equally.
  const ab = await page.evaluate(async () => {
    const { viewer, manager, frameTimes } = window.__universeMap!;
    const times: Record<string, number[]> = { light: [], heavy: [] };
    const points: Record<string, number> = { light: 0, heavy: 0 };
    const visible: Record<string, number> = { light: 0, heavy: 0 };
    const loaded: Record<string, number> = { light: 0, heavy: 0 };
    const raf = () => new Promise((resolve) => requestAnimationFrame(resolve));

    for (let round = 0; round < 3; round++) {
      for (const [key, z] of [
        ['light', 3000],
        ['heavy', 50],
      ] as const) {
        viewer.camera.position.set(0, 0, z);
        for (let i = 0; i < 4; i++) await raf();
        frameTimes.length = 0;
        for (let i = 0; i < 12; i++) await raf();
        times[key]!.push(...frameTimes);
        let v = 0;
        let p = 0;
        for (const mesh of manager.meshes.values()) {
          if (!mesh.visible) continue;
          v++;
          p += mesh.geometry.attributes['position']?.count ?? 0;
        }
        visible[key] = v;
        points[key] = p;
        loaded[key] = manager.meshes.size;
      }
    }

    const median = (values: number[]): number => {
      const sorted = [...values].sort((a, b) => a - b);
      return sorted[Math.floor(sorted.length / 2)] ?? 0;
    };
    return {
      light: {
        median: median(times['light']!),
        samples: times['light']!.length,
        points: points['light']!,
        visible: visible['light']!,
        loaded: loaded['light']!,
      },
      heavy: {
        median: median(times['heavy']!),
        samples: times['heavy']!.length,
        points: points['heavy']!,
        visible: visible['heavy']!,
        loaded: loaded['heavy']!,
      },
    };
  });

  const pointRatio = ab.heavy.points / ab.light.points;
  const timeRatio = ab.heavy.median / ab.light.median;
  console.log(`stream  ${JSON.stringify(streaming)}`);
  console.log(`settled ${JSON.stringify(settled)}`);
  console.log(`light   ${JSON.stringify(ab.light)}`);
  console.log(`heavy   ${JSON.stringify(ab.heavy)}`);
  console.log(`points x${pointRatio.toFixed(3)}  frame time x${timeRatio.toFixed(3)}`);

  expect(streaming.samples).toBeGreaterThan(30);
  expect(ab.light.samples).toBe(36);
  expect(ab.heavy.samples).toBe(36);
  expect(pointRatio).toBeGreaterThan(1.2);

  // No absolute millisecond bound anywhere in this test. A threshold measured on
  // SwiftShader describes the software rasteriser, not the app, and would be
  // permanently red while the same build is smooth on a GPU. Every assertion
  // below is a ratio taken within one run on one machine.

  // Drawing 1.5x the points may cost 1.5x the time; costing more than that means
  // per-point work stopped being linear. The 1.25 is measurement slack, and the
  // bound has to sit above the point ratio rather than below it, because on a
  // GPU that finishes inside the refresh interval both states sit at vsync and
  // the ratio is pinned at 1.0. So this has teeth exactly when frames already
  // overrun the budget - which is the case worth gating. Falsified by injecting
  // a synthetic per-point cost into the frame loop: quadratic in the drawn point
  // count gives a time ratio of 2.67 and trips this, linear of comparable
  // magnitude gives 1.26 and does not.
  expect(timeRatio).toBeLessThan(pointRatio * 1.25);

  // Streaming must not cost dramatically more per frame than drawing the field
  // it sweeps through; if tile decode and upload blocked the loop, the sweep
  // median would run far above the state it starts from.
  expect(streaming.median).toBeLessThan(ab.light.median * 1.5);

  // Every tile is cached by now, so this fails if selection ever degrades to
  // "draw everything that is resident" - the LOD collapse that a point-count or
  // frame-time bound would not distinguish from a slow machine.
  expect(ab.light.visible).toBeLessThan(ab.light.loaded);
  expect(ab.heavy.visible).toBeLessThanOrEqual(384);

  // A fixed camera must reach a steady state: no further fetches, no cache
  // thrash cycling tiles in and out under the byte budget.
  expect(settled.maxInFlight).toBe(0);
  expect(settled.after).toBe(settled.before);
});

test('crosses from the stellar layer out to the local universe', async ({ page }) => {
  const start = await page.evaluate(() => window.__universeMap!.activeLayer().key);
  expect(start).toBe('stellar-neighbourhood');

  const crossing = await page.evaluate(async () => {
    const { viewer, selection, activeLayer } = window.__universeMap!;
    const seen: { key: string; blend: number }[] = [];
    // Sweep outward through the transition band and record what the stack does.
    for (const distance of [3000, 30000, 300000, 3e6, 3e7, 1e8]) {
      viewer.camera.position.set(0, 0, distance);
      await new Promise((r) => requestAnimationFrame(r));
      await new Promise((r) => requestAnimationFrame(r));
      seen.push({ key: activeLayer().key, blend: selection().blend });
    }
    return { seen, end: activeLayer().key };
  });

  console.log(`crossing ${JSON.stringify(crossing.seen)}`);
  // Somewhere in the sweep both layers must be partly visible.
  expect(crossing.seen.some((s) => s.blend > 0 && s.blend < 1)).toBe(true);
  expect(crossing.end).toBe('local-universe');
});

test('shows the solar system when the camera is close to the Sun', async ({ page }) => {
  const key = await page.evaluate(async () => {
    const { viewer, activeLayer } = window.__universeMap!;
    viewer.camera.position.set(0, 0, 1e-6);
    await new Promise((r) => requestAnimationFrame(r));
    await new Promise((r) => requestAnimationFrame(r));
    return activeLayer().key;
  });
  expect(key).toBe('solar-system');
});

test('every layer keeps its own unit', async ({ page }) => {
  const units = await page.evaluate(() =>
    window.__universeMap!.layers.map((l) => `${l.def.key}:${l.def.unit}`),
  );
  expect(units).toEqual(['solar-system:AU', 'stellar-neighbourhood:ly', 'local-universe:Mly']);
});
