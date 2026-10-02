import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './frontend/web/playwright/tests',
  workers: 1,
  timeout: 15_000,
  use: {
    baseURL: 'http://127.0.0.1:5183/playwright/gallery/index.html',
    browserName: 'chromium',
    serviceWorkers: 'block',
  },
  webServer: {
    command: 'npm run dev -w @careeros/web -- --config playwright/vite.config.ts',
    url: 'http://127.0.0.1:5183/playwright/gallery/index.html',
    reuseExistingServer: false,
  },
});
