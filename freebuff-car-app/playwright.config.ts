import { defineConfig, devices } from '@playwright/test';

// Playwright E2E for freebuff-car-app. Runs against the PRODUCTION build
// (`next build && next start`) so the spec covers exactly what ships, in the
// same way the provenance e2e does. Chromium-only: the app is a React SPA
// served by Next with no browser-specific code paths, and one browser keeps
// CI fast and deterministic.
const PORT = Number(process.env.E2E_PORT || 4318);

export default defineConfig({
  testDir: './e2e/specs',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run build && npm run start -- -p 4318',
    url: `http://127.0.0.1:${PORT}/api/version`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
