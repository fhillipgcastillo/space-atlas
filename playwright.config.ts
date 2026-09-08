import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  timeout: 180_000,
  expect: { timeout: 15_000 },
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5173',
    viewport: { width: 1280, height: 720 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // Headless Chromium has no GPU here; SwiftShader is the GL backend and
    // WebGL2 refuses to initialise on it without the unsafe opt-in.
    launchOptions: {
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    },
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    // Adopting a stray dev server would let the suite report green against a
    // build that is not this one.
    reuseExistingServer: !process.env['CI'],
    timeout: 120_000,
  },
});
