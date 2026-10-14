import {defineConfig} from '@playwright/test';
export default defineConfig({
  testDir: './tests', workers: 1, timeout: 15000,
  use: {headless: true, viewport: {width: 420, height: 700}},
  reporter: 'list', outputDir: '../output/extension-test-results',
  webServer: process.env.PLAYWRIGHT_START_FRONTEND === '1' ? {
    command: 'npm --prefix ../frontend run dev -- --host 127.0.0.1 --port 5197 --strictPort',
    url: 'http://127.0.0.1:5197',
    reuseExistingServer: false,
    timeout: 30000,
    env: {VITE_API_BASE_URL: 'http://127.0.0.1:8001'},
  } : undefined,
});
