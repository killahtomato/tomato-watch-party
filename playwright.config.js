import { defineConfig, devices } from '@playwright/test';
import { tmpdir } from 'os';
import { join } from 'path';

const workspace = process.env.TWP_E2E_WORKSPACE || join(tmpdir(), 'twp-e2e-workspace');

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60000,
  expect: { timeout: 10000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  globalSetup: './tests/e2e/global-setup.mjs',
  use: {
    baseURL: 'http://127.0.0.1:3100',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'node server/index.js',
    cwd: __dirname,
    port: 3100,
    timeout: 120000,
    reuseExistingServer: !process.env.CI,
    env: {
      PORT: '3100',
      HOST_PASSWORD: 'e2e-host-password',
      JWT_SECRET: 'e2e-jwt-secret-not-default',
      MOVIE_DIR: join(workspace, 'movies'),
      MUSIC_DIR: join(workspace, 'music'),
      STREAM_DIR: join(workspace, 'streams'),
      DATA_DIR: join(workspace, 'data'),
      TOMATOPLAY_ENABLED: '0',
      LOG_FILE: join(workspace, 'server.log'),
      NODE_ENV: 'test',
    },
  },
});
