import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'retain-on-failure',
    ...devices['Desktop Edge'],
    channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge',
  },
  webServer: [
    {
      command: 'npm run dev',
      url: 'http://127.0.0.1:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command:
        process.platform === 'win32'
          ? '..\\.venv\\Scripts\\python.exe -m uvicorn backend.app.main:app --app-dir .. --host 127.0.0.1 --port 8000'
          : '../.venv/bin/python -m uvicorn backend.app.main:app --app-dir .. --host 127.0.0.1 --port 8000',
      url: 'http://127.0.0.1:8000/api/health',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: { REELWEAVE_WORKING_ROOT: '../var/browser-tests' },
    },
  ],
});
