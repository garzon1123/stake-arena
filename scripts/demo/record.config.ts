import { defineConfig } from '@playwright/test';
// Records the demo video footage. Run with the localnet stack up: see scripts/demo/README.md
export default defineConfig({
  testDir: '.',
  testMatch: 'record.spec.ts',
  timeout: 600_000,
  expect: { timeout: 60_000 },
  use: { baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173' },
  reporter: [['list']],
});
