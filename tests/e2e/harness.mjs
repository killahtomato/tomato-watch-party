import { execFile } from 'child_process';
import { mkdtempSync, mkdirSync, existsSync, writeFileSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(here, '..', '..');

export const HOST_PASSWORD = process.env.E2E_HOST_PASSWORD || 'e2e-host-password';
export const JWT_SECRET = process.env.E2E_JWT_SECRET || 'e2e-jwt-secret-not-default';

export function createWorkspace(prefix = 'twp-e2e-') {
  const workspace = mkdtempSync(join(tmpdir(), prefix));
  const dirs = {
    workspace,
    movies: join(workspace, 'movies'),
    music: join(workspace, 'music'),
    streams: join(workspace, 'streams'),
    data: join(workspace, 'data'),
  };
  for (const dir of Object.values(dirs)) {
    if (dir !== workspace) mkdirSync(dir, { recursive: true });
  }
  return dirs;
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 60000 }, (err, stdout, stderr) => {
      if (err) reject(new Error(`${cmd} ${args.join(' ')} failed: ${stderr || err.message}`));
      else resolve(stdout);
    });
  });
}

export async function makeFixtures(dirs) {
  const moviePath = join(dirs.movies, 'clip.mp4');
  const musicPath = join(dirs.music, 'track-one.wav');
  const subsPath = join(dirs.workspace, 'clip.srt');
  writeFileSync(subsPath, [
    '1',
    '00:00:00,500 --> 00:00:06,000',
    'First subtitle line',
    '',
    '2',
    '00:00:07,000 --> 00:00:14,000',
    'Second subtitle line',
    '',
  ].join('\n'));
  if (!existsSync(moviePath)) {
    await run('ffmpeg', [
      '-y',
      '-f', 'lavfi', '-i', 'testsrc=duration=120:size=320x240:rate=15',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=120',
      '-f', 'srt', '-i', subsPath,
      '-map', '0:v', '-map', '1:a', '-map', '2:s',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-c:s', 'mov_text',
      '-shortest',
      moviePath,
    ]);
  }
  if (!existsSync(musicPath)) {
    await run('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'sine=frequency=660:duration=20', musicPath]);
  }
  return { moviePath, musicPath };
}

const tokenCache = new Map();

export async function fetchHostToken(baseURL = 'http://127.0.0.1:3100') {
  if (tokenCache.has(`host:${baseURL}`)) return tokenCache.get(`host:${baseURL}`);
  const response = await fetch(`${baseURL}/api/host/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: HOST_PASSWORD }),
  });
  const body = await response.json();
  if (!body.token) throw new Error(`host login failed: ${JSON.stringify(body)}`);
  tokenCache.set(`host:${baseURL}`, body.token);
  return body.token;
}

export async function fetchDjToken(baseURL = 'http://127.0.0.1:3100') {
  if (tokenCache.has(`dj:${baseURL}`)) return tokenCache.get(`dj:${baseURL}`);
  const response = await fetch(`${baseURL}/api/dj/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: HOST_PASSWORD }),
  });
  const body = await response.json();
  if (!body.token) throw new Error(`dj login failed: ${JSON.stringify(body)}`);
  tokenCache.set(`dj:${baseURL}`, body.token);
  return body.token;
}

export async function seedHostTokens(page, baseURL = 'http://127.0.0.1:3100') {
  const [hostToken, djToken] = await Promise.all([fetchHostToken(baseURL), fetchDjToken(baseURL)]);
  await page.addInitScript(([host, dj]) => {
    try {
      sessionStorage.setItem('hostToken', host);
      sessionStorage.setItem('djToken', dj);
    } catch {}
  }, [hostToken, djToken]);
}

export async function joinRoom(page, name = 'Tester', baseURL = 'http://127.0.0.1:3100') {
  await page.goto(`${baseURL.replace(/\/$/, '')}/`);
  await page.fill('input', name);
  await page.getByRole('button', { name: 'Join' }).click();
  await page.waitForSelector('.room-switcher');
}

export function readState(workspace) {
  try {
    return JSON.parse(readFileSync(join(workspace, 'data', 'state.json'), 'utf8'));
  } catch {
    return null;
  }
}

export function writeState(workspace, state) {
  const path = join(workspace, 'data', 'state.json');
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(state));
}

export function parseClock(text) {
  const match = String(text || '').match(/(\d+):(\d{2})/);
  if (!match) return 0;
  return parseInt(match[1], 10) * 60 + parseInt(match[2], 10);
}

export { execFileAsync };
