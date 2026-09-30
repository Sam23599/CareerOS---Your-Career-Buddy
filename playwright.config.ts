import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './frontend/web/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  use: { baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:5173', browserName: 'chromium' },
});
