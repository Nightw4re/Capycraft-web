import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 45_000,
  expect: { timeout: 12_000 },
  workers: 1,
  use: {
    baseURL: process.env.CAPYCRAFT_E2E_URL || 'http://127.0.0.1:5173',
    browserName: 'chromium',
    viewport: { width: 1280, height: 900 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
