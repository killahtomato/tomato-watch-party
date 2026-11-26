import { test, expect } from '@playwright/test';
import { spawn } from 'child_process';
import { join } from 'path';
import {
  createWorkspace,
  makeFixtures,
  readState,
  seedHostTokens,
  joinRoom,
  HOST_PASSWORD,
  JWT_SECRET,
  REPO_ROOT,
} from './harness.mjs';

const PORT = 3107;
const BASE = `http://127.0.0.1:${PORT}`;

async function startServer(dirs) {
  const child = spawn('node', ['server/index.js'], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      HOST_PASSWORD,
      JWT_SECRET,
      MOVIE_DIR: dirs.movies,
      MUSIC_DIR: dirs.music,
      STREAM_DIR: dirs.streams,
      DATA_DIR: dirs.data,
      TOMATOPLAY_ENABLED: '0',
      LOG_FILE: join(dirs.workspace, 'server.log'),
      NODE_ENV: 'test',
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  child.stderr.on('data', () => {});

  const deadline = Date.now() + 40000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${BASE}/`);
      if (response.ok) return child;
    } catch {}
    if (child.exitCode !== null) throw new Error('E2E server exited before listening');
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('E2E server did not start in time');
}

async function stopServer(child) {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline && child.exitCode === null) {
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  if (child.exitCode === null) child.kill('SIGKILL');
}

async function hostJoins(page, name) {
  await seedHostTokens(page, BASE);
  await joinRoom(page, name, BASE);
}

test.describe.serial('resume across restart', () => {
  let dirs;
  let server;

  test.beforeAll(async () => {
    dirs = createWorkspace('twp-resume-');
    await makeFixtures(dirs);
  });

  test.afterAll(async () => {
    await stopServer(server);
  });

  test('policy ON resumes playing; OFF restores paused at the same position', async ({ browser }) => {
    // Phase 1: default policy is ON. Play from the library.
    server = await startServer(dirs);
    const context = await browser.newContext();
    const page = await context.newPage();
    await hostJoins(page, 'ResumeE2E');
    await page.click('.movie-panel-tab:not(.web-panel-tab)');
    await page.getByRole('button', { name: /clip/ }).click();
    await page.locator('.host-buttons button').first().click();
    await expect(page.locator('.host-buttons button').first()).toContainText('Pause');
    await expect.poll(() => readState(dirs.workspace)?.movie?.isPlaying ?? false, {
      timeout: 20000,
      message: 'expected the saved snapshot to show playing',
    }).toBe(true);
    await context.close();
    await stopServer(server);
    server = null;

    // Restart with policy still ON: playback resumes on its own.
    server = await startServer(dirs);
    const onContext = await browser.newContext();
    const onPage = await onContext.newPage();
    await hostJoins(onPage, 'ResumeE2E_On');
    await expect(onPage.locator('.host-buttons button').first()).toContainText('Pause');
    await expect.poll(() => readState(dirs.workspace)?.movie?.currentTime ?? 0, {
      timeout: 20000,
      message: 'expected the saved position to advance past 3s',
    }).toBeGreaterThan(3);
    await onContext.close();

    // Turn the policy OFF, then restart: restored paused at the saved position.
    const toggleContext = await browser.newContext();
    const togglePage = await toggleContext.newPage();
    await hostJoins(togglePage, 'ResumeToggle');
    // Movie, web and DJ host bars can all be mounted; they drive the same policy.
    // Target the movie host bar (the web bar carries .web-host-controls).
    const resumeSwitch = togglePage.locator('.host-controls:not(.web-host-controls) .resume-switch');
    await resumeSwitch.click();
    await expect(resumeSwitch).not.toHaveClass(/on/);
    await toggleContext.close();
    await stopServer(server);
    server = null;

    server = await startServer(dirs);
    const offContext = await browser.newContext();
    const offPage = await offContext.newPage();
    await hostJoins(offPage, 'ResumeE2E_Off');
    // Paused mid-track shows "Resume" rather than "Play".
    await expect(offPage.locator('.host-buttons button').first()).toContainText(/Resume|Play/);
    await expect.poll(() => readState(dirs.workspace)?.movie?.currentTime ?? 0, {
      timeout: 20000,
      message: 'expected the paused position to be preserved',
    }).toBeGreaterThan(3);
    await offContext.close();
  });
});
