import { defineConfig } from '@playwright/test';

// Assumes the stack is running (see README → Testing): validator/devnet + server + web.
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 180_000,
  expect: { timeout: 30_000 },
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    viewport: { width: 1440, height: 960 },
    screenshot: 'only-on-failure',
  },
  reporter: [['list']],
});
