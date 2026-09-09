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

// An element screenshot would carry the DOM overlays drawn on top of the canvas
// - the Earth anchor and the modeled notice - into the count. The drawing buffer
// has no preserveDrawingBuffer, so it is only readable inside the task that drew
// it: render and read in one go.
// Rendering the scene straight to the canvas would measure a frame nobody sees:
// every material is a RawShaderMaterial, so three injects no tone mapping and
// the direct render carries neither bloom nor exposure. Only the composer chain
// produces the displayed image.
function measureLuminance(page: Page): Promise<{ mean: number; litFraction: number }> {
  return page.evaluate(() => {
    const { viewer } = window.__universeMap!;
    viewer.renderFrame();
    const gl = viewer.renderer.getContext();
    const width = viewer.renderer.domElement.width;
    const height = viewer.renderer.domElement.height;
    const pixels = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let total = 0;
    let lit = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      const luminance = 0.2126 * pixels[i]! + 0.7152 * pixels[i + 1]! + 0.0722 * pixels[i + 2]!;
      total += luminance;
      if (luminance >= 1) lit++;
    }
    const count = width * height;
    return { mean: total / count, litFraction: lit / count };
  });
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

  // The card names the layer's own origin, which registry.ts gives as Sol for
  // the stellar neighbourhood; the Earth anchor is a separate overlay.
  const reported = /^([\d.]+) ly from Sol$/.exec(lines[2] ?? '');
  expect(reported).not.toBeNull();
  // The card must report the distance to the point that was actually picked.
  expect(Number(reported![1])).toBeCloseTo(probe!.distance, 1);
  // L1 runs to max_radius_ly = 5000 (pipeline/universe_pipeline/config.py).
  expect(probe!.distance).toBeLessThan(5000);
});

// Five layers load 320 tiles at roughly 700 ms a frame under SwiftShader, so
// this one sweeps for longer than the default 3-minute cap allows. The bound
// raised here is wall-clock only; every assertion below is unchanged.
test('frame cost scales with the points drawn and streaming converges', async ({ page }) => {
  test.setTimeout(420_000);
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
    // Sweep outward through both transition bands and record what the stack
    // does. The milky-way layer overlaps its neighbours over 3,000-5,000 ly and
    // 300,000-400,000 ly, so 4,000 and 350,000 land inside a crossfade.
    for (const distance of [3000, 4000, 30000, 350000, 3e6, 3e7, 1e8]) {
      viewer.camera.position.set(0, 0, distance);
      await new Promise((r) => requestAnimationFrame(r));
      await new Promise((r) => requestAnimationFrame(r));
      seen.push({ key: activeLayer().key, blend: selection().blend });
    }
    return { seen, end: activeLayer().key };
  });

  console.log(`crossing ${JSON.stringify(crossing.seen)}`);
  // Crossings must blend rather than switch hard. Which specific boundaries a
  // fixed sweep lands on shifts whenever a layer is added, so assert that
  // several distinct boundaries blend rather than naming them.
  const blending = crossing.seen.filter((s) => s.blend > 0 && s.blend < 1);
  expect(new Set(blending.map((s) => s.key)).size).toBeGreaterThanOrEqual(2);
  expect(blending.map((s) => s.key)).toContain('stellar-neighbourhood');
  // The sweep ends in the outermost layer of whatever ladder is registered.
  expect(crossing.end).toBe('cosmic-web');
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
  expect(units).toEqual([
    'solar-system:AU',
    'stellar-neighbourhood:ly',
    'milky-way:ly',
    'local-universe:Mly',
    'cosmic-web:Mly',
  ]);
});

test('the milky way layer takes over between the stars and the galaxies', async ({ page }) => {
  const keys = await page.evaluate(async () => {
    const { viewer, activeLayer } = window.__universeMap!;
    const seen: string[] = [];
    for (const d of [1000, 20000, 100000, 3e5, 1e6]) {
      viewer.camera.position.set(0, 0, d);
      await new Promise((r) => requestAnimationFrame(r));
      await new Promise((r) => requestAnimationFrame(r));
      seen.push(activeLayer().key);
    }
    return seen;
  });
  console.log(`active layers across the sweep: ${keys.join(' -> ')}`);
  expect(keys).toContain('milky-way');
});

test('the modeled population is announced whenever it is visible', async ({ page }) => {
  await page.evaluate(async () => {
    window.__universeMap!.viewer.camera.position.set(0, 0, 50000);
    await new Promise((r) => setTimeout(r, 4000));
  });
  await expect(page.getByTestId('modeled-notice')).toBeVisible();
});

test('hovering never reports a modeled object', async ({ page }) => {
  const probe = await page.evaluate(async () => {
    const { viewer, manager, picking, hover } = window.__universeMap!;
    viewer.camera.position.set(0, 0, 50000);
    await new Promise((r) => setTimeout(r, 6000));
    let sampled = 0;
    let hits = 0;
    let modeledHits = 0;
    for (let x = 200; x < 1100; x += 60) {
      for (let y = 150; y < 550; y += 80) {
        sampled++;
        if (hover.pick(x, y)) hits++;
        const id = picking.pickAt(x, y);
        if (!id) continue;
        const tile = manager.tilesBySlot.get(id.tileSlot)?.tile;
        if (!tile) continue;
        // FLAG_MODELED is bit 0x10 (pipeline/universe_pipeline/records.py).
        if (tile.typeFlags[id.vertexIndex]! & 0x10) modeledHits++;
      }
    }
    return { sampled, hits, modeledHits, layer: window.__universeMap!.activeLayer().key };
  });
  // Without this the zero below could just mean nothing was on screen to pick.
  const field = await measureLuminance(page);
  console.log(`pick probe ${JSON.stringify(probe)} over ${(field.litFraction * 100).toFixed(1)}% lit`);
  expect(probe.layer).toBe('milky-way');
  expect(probe.sampled).toBeGreaterThan(40);
  expect(field.litFraction).toBeGreaterThan(0.1);
  // The modeled field fills this view, so every probe position sits over points
  // that could pass themselves off as measurements.
  expect(probe.modeledHits).toBe(0);
});

test('the sparse gap between stars and galaxies is gone', async ({ page }) => {
  await page.evaluate(async () => {
    window.__universeMap!.viewer.camera.position.set(0, 0, 50000);
    await new Promise((r) => setTimeout(r, 6000));
  });
  await waitForIdleLoader(page);

  const lit = await measureLuminance(page);
  // Hiding the layer groups would not hold: the frame loop rewrites
  // group.visible from the layer's opacity every tick.
  await page.evaluate(() => {
    window.__universeMap!.viewer.scene.visible = false;
  });
  await page.waitForTimeout(1500);
  const blank = await measureLuminance(page);

  console.log(
    `50,000 ly: mean luminance ${lit.mean.toFixed(2)} over ${(lit.litFraction * 100).toFixed(1)}% lit pixels; ` +
      `blank ${blank.mean.toFixed(3)} over ${(blank.litFraction * 100).toFixed(1)}%`,
  );
  // Before this layer existed the whole 5,000 - 300,000 ly span rendered below
  // 0.2 mean luminance. Measured through the composer it now reads 18.48 at
  // 46.0% lit at 30,000 ly, 18.81 at 56.0% at 50,000 ly, and 15.63 at 59.7% out
  // at 120,000 ly. These bounds sit an order of magnitude above the old regime
  // and well under the new one, so they discriminate between the two rather than
  // merely rejecting a wholly black frame.
  expect(lit.mean).toBeGreaterThan(1.5);
  expect(lit.litFraction).toBeGreaterThan(0.03);
  expect(blank.mean).toBeLessThan(0.2);
});

const clockYears = (page: Page): Promise<number> =>
  page.evaluate(() => window.__universeMap!.viewer.getTimeYears());

// A layer copies the clock into its uniforms inside its own per-frame update, so
// a time set through the viewer reaches the shader on the next frame, not at once.
async function setClock(page: Page, years: number): Promise<void> {
  await page.evaluate(async (value) => {
    window.__universeMap!.viewer.setTimeYears(value);
    for (let i = 0; i < 4; i++) await new Promise((r) => requestAnimationFrame(r));
  }, years);
}

// Renders through the composer, keeps that frame's luminance on the page, and
// reports how much of it changed since the previous call. Mean luminance alone is
// a weak signal here: the field can travel a long way while the total brightness
// barely moves, so the discriminating number is the changed fraction.
function sampleFrame(page: Page): Promise<{ mean: number; changed: number }> {
  return page.evaluate(() => {
    const { viewer } = window.__universeMap!;
    viewer.renderFrame();
    const gl = viewer.renderer.getContext();
    const width = viewer.renderer.domElement.width;
    const height = viewer.renderer.domElement.height;
    const pixels = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

    const luminance = new Uint8Array(width * height);
    let total = 0;
    for (let i = 0; i < luminance.length; i++) {
      const value =
        0.2126 * pixels[i * 4]! + 0.7152 * pixels[i * 4 + 1]! + 0.0722 * pixels[i * 4 + 2]!;
      luminance[i] = value;
      total += value;
    }

    const store = window as unknown as { __timeFrame?: Uint8Array };
    const previous = store.__timeFrame;
    store.__timeFrame = luminance;
    let changed = 0;
    if (previous?.length === luminance.length) {
      for (let i = 0; i < luminance.length; i++) {
        if (Math.abs(luminance[i]! - previous[i]!) > 16) changed++;
      }
    }
    return {
      mean: total / luminance.length,
      changed: previous ? changed / luminance.length : Number.NaN,
    };
  });
}

test('the time control opens at present day', async ({ page }) => {
  await expect(page.getByTestId('time-controls')).toBeVisible();
  await expect(page.getByTestId('time-readout')).toHaveText('present day');
  expect(await clockYears(page)).toBe(0);
  await expect(page.getByTestId('time-disclosure')).not.toBeVisible();
});

test('dragging the time slider moves the field', async ({ page }) => {
  await waitForIdleLoader(page);
  // Exposure adaptation rescales the whole frame between the two grabs, which
  // would read as motion; pin it so the diff measures only the field.
  await page.evaluate(() => window.__universeMap!.viewer.setAutoExposure(false));
  const before = await sampleFrame(page);

  const box = (await page.getByTestId('time-slider').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  // Past the right edge, so the value lands on MAX_YEARS rather than on wherever
  // the thumb geometry puts it.
  await page.mouse.move(box.x + box.width + 200, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();

  await expect(page.getByTestId('time-readout')).toHaveText('+1,000,000 years');
  expect(await clockYears(page)).toBe(1_000_000);

  await page.evaluate(async () => {
    for (let i = 0; i < 4; i++) await new Promise((r) => requestAnimationFrame(r));
  });
  const after = await sampleFrame(page);
  console.log(
    `time drag: mean ${before.mean.toFixed(2)} -> ${after.mean.toFixed(2)}, ` +
      `${(after.changed * 100).toFixed(1)}% of pixels changed`,
  );
  expect(after.changed).toBeGreaterThan(0.02);
});

test('the disclosure appears off present day and goes away at zero', async ({ page }) => {
  // Also the check that the clock does not survive the navigation in beforeEach:
  // the test above leaves it at MAX_YEARS.
  expect(await clockYears(page)).toBe(0);
  const disclosure = page.getByTestId('time-disclosure');
  await expect(disclosure).not.toBeVisible();

  await setClock(page, 250_000);
  await expect(disclosure).toBeVisible();
  await expect(disclosure).toContainText(
    /\d+% of the catalogued objects in view have no measured radial velocity/,
  );
  await expect(disclosure).toContainText('million years');
  console.log(`disclosure: ${await disclosure.textContent()}`);

  await page.getByTestId('time-reset').click();
  await expect(page.getByTestId('time-readout')).toHaveText('present day');
  await expect(disclosure).not.toBeVisible();
  expect(await clockYears(page)).toBe(0);
});

test('the modeled population stands still while measured stars move', async ({ page }) => {
  test.setTimeout(300_000);
  // Both populations are on screen here: the stellar layer and the modeled
  // milky-way layer overlap across 3,000-5,000 ly.
  await page.evaluate(async () => {
    window.__universeMap!.viewer.camera.position.set(0, 0, 4000);
    await new Promise((r) => setTimeout(r, 8000));
  });
  await waitForIdleLoader(page);

  const YEARS = 200_000;
  const probe = await page.evaluate(async (years) => {
    const { viewer, layers } = window.__universeMap!;
    type SlotEntry = NonNullable<
      ReturnType<(typeof layers)[number]['manager']['tilesBySlot']['get']>
    >;
    const width = window.innerWidth;
    const height = window.innerHeight;
    const scratch = viewer.camera.position.clone();
    const uniformsOf = (entry: SlotEntry): Record<string, { value: unknown }> =>
      (entry.mesh.material as unknown as Record<string, Record<string, { value: unknown }>>)[
        'uniforms'
      ]!;

    // The vertex shader's own arithmetic, over the mesh's own uniforms and the
    // buffers that were uploaded to the GPU.
    const screenAt = (entry: SlotEntry, index: number, timeYears: number) => {
      const uniforms = uniformsOf(entry);
      const scale = uniforms['uVelocityScale']!.value as number;
      const min = uniforms['uBboxMin']!.value as { x: number; y: number; z: number };
      const extent = uniforms['uBboxExtent']!.value as { x: number; y: number; z: number };
      const position = entry.mesh.geometry.attributes['position']!;
      const velocity = entry.mesh.geometry.attributes['aVelocity']!;
      scratch.set(
        min.x + position.getX(index) * extent.x + velocity.getX(index) * timeYears * scale,
        min.y + position.getY(index) * extent.y + velocity.getY(index) * timeYears * scale,
        min.z + position.getZ(index) * extent.z + velocity.getZ(index) * timeYears * scale,
      );
      scratch.applyMatrix4(entry.mesh.matrixWorld).project(viewer.camera);
      return {
        x: ((scratch.x + 1) / 2) * width,
        y: ((1 - scratch.y) / 2) * height,
        inFrustum: Math.abs(scratch.x) <= 1 && Math.abs(scratch.y) <= 1 && Math.abs(scratch.z) <= 1,
      };
    };

    // Prime, so the walk never lands in step with a tile's own point ordering.
    const STRIDE = 17;
    let modeled: { entry: SlotEntry; index: number; layer: string } | undefined;
    let measured: { entry: SlotEntry; index: number; layer: string; transverse: number } | undefined;

    for (const layer of layers) {
      for (const entry of layer.manager.tilesBySlot.values()) {
        if (!entry.mesh.visible) continue;
        const velocity = entry.mesh.geometry.attributes['aVelocity']!;
        for (let i = 0; i < entry.tile.pointCount; i += STRIDE) {
          if (!screenAt(entry, i, 0).inFrustum) continue;
          // FLAG_MODELED is bit 0x10 (pipeline/universe_pipeline/records.py).
          if ((entry.tile.typeFlags[i]! & 0x10) !== 0) {
            modeled ??= { entry, index: i, layer: layer.def.key };
            continue;
          }
          // The camera sits on +z looking at the origin, so x and y carry the
          // motion across the view; a point drifting along the line of sight
          // would barely shift its projection however fast it travels.
          const transverse = Math.hypot(velocity.getX(i), velocity.getY(i));
          if (!measured || transverse > measured.transverse) {
            measured = { entry, index: i, layer: layer.def.key, transverse };
          }
        }
      }
    }
    if (!modeled || !measured) return null;

    viewer.setTimeYears(years);
    for (let i = 0; i < 4; i++) await new Promise((r) => requestAnimationFrame(r));

    // Both times are projected in this one task against one camera state, so
    // nothing but the clock can move a point. The late time comes from the mesh's
    // own uniform: a clock that never reached this tile reads as zero motion and
    // fails the measured assertion.
    const report = (candidate: { entry: SlotEntry; index: number; layer: string }) => {
      const velocity = candidate.entry.mesh.geometry.attributes['aVelocity']!;
      const at = uniformsOf(candidate.entry)['uTimeYears']!.value as number;
      const before = screenAt(candidate.entry, candidate.index, 0);
      const after = screenAt(candidate.entry, candidate.index, at);
      return {
        layer: candidate.layer,
        index: candidate.index,
        uniformYears: at,
        speed: Math.hypot(
          velocity.getX(candidate.index),
          velocity.getY(candidate.index),
          velocity.getZ(candidate.index),
        ),
        velocity: [
          velocity.getX(candidate.index),
          velocity.getY(candidate.index),
          velocity.getZ(candidate.index),
        ],
        before: { x: before.x, y: before.y },
        after: { x: after.x, y: after.y },
        moved: Math.hypot(after.x - before.x, after.y - before.y),
      };
    };
    return { modeled: report(modeled), measured: report(measured) };
  }, YEARS);

  expect(probe).not.toBeNull();
  const { modeled, measured } = probe!;
  console.log(`modeled  ${JSON.stringify(modeled)}`);
  console.log(`measured ${JSON.stringify(measured)}`);

  // The clock has to have reached both tiles, or neither side means anything.
  expect(modeled.uniformYears).toBe(YEARS);
  expect(measured.uniformYears).toBe(YEARS);

  // The modeled population carries no kinematics at all, so it must not shift by
  // so much as a float: this is the claim the disclosure makes, in test form.
  expect(modeled.speed).toBe(0);
  expect(modeled.after.x).toBe(modeled.before.x);
  expect(modeled.after.y).toBe(modeled.before.y);

  expect(measured.speed).toBeGreaterThan(0);
  expect(measured.moved).toBeGreaterThan(5);
});

test('hover picks the field where it is at the current time', async ({ page }) => {
  test.setTimeout(300_000);
  await waitForIdleLoader(page);
  await page.evaluate(() => window.__universeMap!.identifiersReady);
  await setClock(page, 1_000_000);

  const probe = await page.evaluate(() => {
    const { viewer, manager, picking, hover } = window.__universeMap!;
    type SlotEntry = NonNullable<ReturnType<(typeof manager)['tilesBySlot']['get']>>;
    const width = window.innerWidth;
    const height = window.innerHeight;
    const scratch = viewer.camera.position.clone();
    const uniformsOf = (entry: SlotEntry): Record<string, { value: unknown }> =>
      (entry.mesh.material as unknown as Record<string, Record<string, { value: unknown }>>)[
        'uniforms'
      ]!;

    const screenAt = (entry: SlotEntry, index: number, timeYears: number) => {
      const uniforms = uniformsOf(entry);
      const scale = uniforms['uVelocityScale']!.value as number;
      const min = uniforms['uBboxMin']!.value as { x: number; y: number; z: number };
      const extent = uniforms['uBboxExtent']!.value as { x: number; y: number; z: number };
      const position = entry.mesh.geometry.attributes['position']!;
      const velocity = entry.mesh.geometry.attributes['aVelocity']!;
      scratch.set(
        min.x + position.getX(index) * extent.x + velocity.getX(index) * timeYears * scale,
        min.y + position.getY(index) * extent.y + velocity.getY(index) * timeYears * scale,
        min.z + position.getZ(index) * extent.z + velocity.getZ(index) * timeYears * scale,
      );
      scratch.applyMatrix4(entry.mesh.matrixWorld).project(viewer.camera);
      return { x: ((scratch.x + 1) / 2) * width, y: ((1 - scratch.y) / 2) * height };
    };

    const hits: { atTime: number; atZero: number }[] = [];
    let sampled = 0;
    let carded = 0;
    for (let x = 240; x < 1100; x += 120) {
      for (let y = 160; y < 620; y += 100) {
        sampled++;
        const id = picking.pickAt(x, y);
        if (!id) continue;
        const entry = manager.tilesBySlot.get(id.tileSlot);
        if (!entry || id.vertexIndex >= entry.tile.pointCount) continue;
        const atTime = screenAt(entry, id.vertexIndex, uniformsOf(entry)['uTimeYears']!
          .value as number);
        const atZero = screenAt(entry, id.vertexIndex, 0);
        if (hover.pick(x, y)) carded++;
        hits.push({
          atTime: Math.hypot(atTime.x - x, atTime.y - y),
          atZero: Math.hypot(atZero.x - x, atZero.y - y),
        });
      }
    }
    return { sampled, carded, hits, years: viewer.getTimeYears() };
  });

  const median = (values: number[]): number => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)] ?? 0;
  };
  const atTime = probe.hits.map((h) => h.atTime);
  const atZero = probe.hits.map((h) => h.atZero);
  console.log(
    `pick at ${probe.years} yr: ${probe.hits.length}/${probe.sampled} hits, ${probe.carded} carded, ` +
      `offset at time median ${median(atTime).toFixed(1)}px max ${Math.max(...atTime).toFixed(1)}px, ` +
      `at t=0 median ${median(atZero).toFixed(1)}px`,
  );

  expect(probe.years).toBe(1_000_000);
  expect(probe.hits.length).toBeGreaterThan(4);
  expect(probe.carded).toBe(probe.hits.length);
  // The pick point is 10 CSS px wide and the scissor adds 2, so a hit can sit a
  // few pixels off the probe, but not tens.
  expect(Math.max(...atTime)).toBeLessThan(24);
  // And the clock has to be what put it there: at t = 0 the same points project
  // nowhere near the pixel they were picked at, so the bound above is not
  // something a time-blind pick pass could satisfy.
  expect(median(atZero)).toBeGreaterThan(24);
});

// The screenAt helpers above replicate the linear p0 + v*t, which is only what
// the GPU draws while deep time is off; every test that uses one keeps the
// toggle off. The deep-time tests below never replicate the orbit: they read
// back where the GPU actually put a point, through the pick pass.
async function enableDeepTime(page: Page, years: number): Promise<void> {
  await page.evaluate(async (value) => {
    const { timeControls } = window.__universeMap!;
    timeControls.setDeep(true);
    timeControls.setYears(value);
    for (let i = 0; i < 6; i++) await new Promise((r) => requestAnimationFrame(r));
  }, years);
}

test('the deep time toggle extends the range and reads out in millions of years', async ({
  page,
}) => {
  const slider = page.getByTestId('time-slider');
  await expect(slider).toHaveAttribute('max', '1000000');
  await expect(slider).toHaveAttribute('min', '-1000000');

  await page.getByTestId('time-deep').check();
  await expect(slider).toHaveAttribute('max', '250000000');
  await expect(slider).toHaveAttribute('min', '-250000000');

  const box = (await slider.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width + 200, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();

  await expect(page.getByTestId('time-readout')).toHaveText('+250.0 million years');
  expect(await page.evaluate(() => window.__universeMap!.timeControls.currentYears)).toBe(
    250_000_000,
  );
  const deepUniforms = await page.evaluate(() =>
    window.__universeMap!.layers.flatMap((layer) =>
      [...layer.manager.tilesBySlot.values()].map(
        (entry) =>
          (entry.mesh.material as unknown as { uniforms: Record<string, { value: number }> })
            .uniforms['uDeepTime']!.value,
      ),
    ),
  );
  expect(deepUniforms.length).toBeGreaterThan(0);
  expect(deepUniforms.every((value) => value === 1)).toBe(true);

  // Off again and the range is the Phase 4 one, with the clock folded back into it.
  await page.getByTestId('time-deep').uncheck();
  await expect(slider).toHaveAttribute('max', '1000000');
  await expect(page.getByTestId('time-readout')).toHaveText('+1,000,000 years');
  expect(await clockYears(page)).toBe(1_000_000);
});

test('the deep disclosure replaces the Phase 4 one, and only in deep mode', async ({ page }) => {
  await page.evaluate(async () => {
    window.__universeMap!.viewer.camera.position.set(0, 0, 50000);
    await new Promise((r) => setTimeout(r, 8000));
  });
  const disclosure = page.getByTestId('time-disclosure');
  await setClock(page, 250_000);
  await expect(disclosure).toBeVisible();
  await expect(disclosure).toContainText('stay perfectly still');
  await expect(disclosure).toContainText('straight-line extrapolation');
  const shallow = (await disclosure.textContent())!;

  await enableDeepTime(page, 200_000_000);
  await expect(disclosure).toContainText('axisymmetric');
  const deep = (await disclosure.textContent())!;
  console.log(`phase 4 disclosure: ${shallow}`);
  console.log(`deep disclosure: ${deep}`);

  // The Phase 4 sentence is false once the modeled points are on orbits.
  expect(deep).not.toContain('stay perfectly still');
  expect(deep).not.toContain('no kinematics');
  expect(deep).toContain('assumed circular orbits');
  expect(deep).toContain('vertical structure is held static');
  expect(deep).toContain('no bar, no spiral arms, no scattering off molecular clouds, no mergers');
  expect(deep).toContain('39.6 km/s/kpc');
  expect(deep).toContain('5.4% of galactocentric radius at 250 million years');
  expect(deep).toContain('no measured radial velocity');

  await page.getByTestId('time-deep').uncheck();
  await expect(disclosure).toContainText('straight-line extrapolation');
  expect(await disclosure.textContent()).not.toContain('axisymmetric');
});

test('at 200 Myr the field is sheared, not rigidly translated', async ({ page }) => {
  test.setTimeout(300_000);
  await page.evaluate(async () => {
    window.__universeMap!.viewer.camera.position.set(0, 0, 50000);
    await new Promise((r) => setTimeout(r, 8000));
  });
  await waitForIdleLoader(page);
  await enableDeepTime(page, 200_000_000);

  const probe = await page.evaluate(() => {
    const { viewer, picking, ownerForSlot } = window.__universeMap!;
    type SlotEntry = NonNullable<
      ReturnType<NonNullable<ReturnType<typeof ownerForSlot>>['manager']['tilesBySlot']['get']>
    >;
    const width = window.innerWidth;
    const height = window.innerHeight;
    const scratch = viewer.camera.position.clone();
    const uniformsOf = (entry: SlotEntry): Record<string, { value: unknown }> =>
      (entry.mesh.material as unknown as Record<string, Record<string, { value: unknown }>>)[
        'uniforms'
      ]!;

    const project = (entry: SlotEntry, x: number, y: number, z: number) => {
      scratch.set(x, y, z).applyMatrix4(entry.mesh.matrixWorld).project(viewer.camera);
      return { x: ((scratch.x + 1) / 2) * width, y: ((1 - scratch.y) / 2) * height };
    };

    // Present day needs no model: it is the baked position, so this replicates
    // nothing the shader does past t = 0.
    const basePosition = (entry: SlotEntry, index: number): [number, number, number] => {
      const uniforms = uniformsOf(entry);
      const min = uniforms['uBboxMin']!.value as { x: number; y: number; z: number };
      const extent = uniforms['uBboxExtent']!.value as { x: number; y: number; z: number };
      const position = entry.mesh.geometry.attributes['position']!;
      return [
        min.x + position.getX(index) * extent.x,
        min.y + position.getY(index) * extent.y,
        min.z + position.getZ(index) * extent.z,
      ];
    };

    const R0_PC = 8122;
    const Z_SUN_PC = 20.8;
    const hits: {
      layer: string;
      radiusPc: number;
      dx: number;
      dy: number;
      gcNow: number;
      gcThen: number;
      years: number;
    }[] = [];
    let sampled = 0;
    for (let x = 160; x < 1200; x += 40) {
      for (let y = 120; y < 660; y += 40) {
        sampled++;
        const id = picking.pickAt(x, y);
        if (!id) continue;
        const owner = ownerForSlot(id.tileSlot);
        const entry = owner?.manager.tilesBySlot.get(id.tileSlot);
        if (!owner || !entry || id.vertexIndex >= entry.tile.pointCount) continue;
        const uniforms = uniformsOf(entry);
        const parsecsPerUnit = uniforms['uLayerParsecsPerUnit']!.value as number;
        const base = basePosition(entry, id.vertexIndex);
        const now = project(entry, base[0], base[1], base[2]);
        // The Galactic Centre sits R0 up the +x axis from the Sun, which is
        // itself Z_SUN above the plane.
        const centre = project(entry, R0_PC / parsecsPerUnit, 0, -Z_SUN_PC / parsecsPerUnit);
        hits.push({
          layer: owner.def.key,
          radiusPc: Math.hypot(base[0] * parsecsPerUnit - R0_PC, base[1] * parsecsPerUnit),
          dx: x - now.x,
          dy: y - now.y,
          gcNow: Math.hypot(now.x - centre.x, now.y - centre.y),
          gcThen: Math.hypot(x - centre.x, y - centre.y),
          years: uniforms['uTimeYears']!.value as number,
        });
      }
    }
    return { sampled, hits };
  });

  const median = (values: number[]): number => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)] ?? 0;
  };
  // Close to the projected centre the pick point's own width dominates the
  // radius, and every azimuth is a few pixels apart.
  const hits = probe.hits.filter((h) => h.gcNow > 150);

  expect(probe.hits.length).toBeGreaterThan(0);
  expect(probe.hits.every((h) => h.years === 200_000_000)).toBe(true);
  expect(hits.length).toBeGreaterThan(8);

  const magnitudes = hits.map((h) => Math.hypot(h.dx, h.dy));
  const meanDx = hits.reduce((sum, h) => sum + h.dx, 0) / hits.length;
  const meanDy = hits.reduce((sum, h) => sum + h.dy, 0) / hits.length;
  const meanMagnitude = Math.hypot(meanDx, meanDy);
  // The best rigid translation of this field is its mean displacement; what is
  // left over is the part no translation can explain.
  const residual = Math.sqrt(
    hits.reduce((sum, h) => sum + (h.dx - meanDx) ** 2 + (h.dy - meanDy) ** 2, 0) / hits.length,
  );
  const angles = hits.map((h) => (Math.atan2(h.dy, h.dx) * 180) / Math.PI);
  const angleSpread = Math.max(...angles) - Math.min(...angles);
  const radialShift = hits.map((h) => Math.abs(h.gcThen - h.gcNow));
  const radialChange = hits.map((h) => Math.abs(h.gcThen - h.gcNow) / h.gcNow);

  const byRadius = [...hits].sort((a, b) => a.radiusPc - b.radiusPc);
  const half = Math.floor(byRadius.length / 2);
  const meanOf = (group: typeof hits) => ({
    radiusPc: group.reduce((s, h) => s + h.radiusPc, 0) / group.length,
    dx: group.reduce((s, h) => s + h.dx, 0) / group.length,
    dy: group.reduce((s, h) => s + h.dy, 0) / group.length,
  });
  const innerMean = meanOf(byRadius.slice(0, half));
  const outerMean = meanOf(byRadius.slice(half));

  console.log(
    `shear at 200 Myr: ${hits.length} hits over ${probe.sampled} probes, ` +
      `median displacement ${median(magnitudes).toFixed(1)}px, ` +
      `mean translation ${meanMagnitude.toFixed(1)}px, residual about it ${residual.toFixed(1)}px, ` +
      `direction spread ${angleSpread.toFixed(0)} deg, ` +
      `median galactocentric radius ${median(hits.map((h) => h.gcNow)).toFixed(0)}px, ` +
      `changing by ${median(radialShift).toFixed(1)}px (${(median(radialChange) * 100).toFixed(1)}%)`,
  );
  console.log(
    `inner half (mean R ${(innerMean.radiusPc / 1000).toFixed(1)} kpc) moved ` +
      `(${innerMean.dx.toFixed(1)}, ${innerMean.dy.toFixed(1)})px; outer half ` +
      `(mean R ${(outerMean.radiusPc / 1000).toFixed(1)} kpc) moved ` +
      `(${outerMean.dx.toFixed(1)}, ${outerMean.dy.toFixed(1)})px`,
  );

  // The field moved at all.
  expect(median(magnitudes)).toBeGreaterThan(100);
  // And not as one piece: a rigid translation leaves no residual about its mean
  // and points every displacement the same way.
  expect(residual).toBeGreaterThan(meanMagnitude);
  expect(angleSpread).toBeGreaterThan(60);
  // What differential rotation does instead: each point keeps its galactocentric
  // radius and changes azimuth. A translation of this size cannot: displaced by
  // |d| in a direction unrelated to the centre, the median radius moves by
  // 0.71|d|. The residual here is the model's own 4% of R at this range plus the
  // width of the pick point.
  expect(median(radialChange)).toBeLessThan(0.25);
  expect(median(radialShift)).toBeLessThan(0.4 * median(magnitudes));
});
