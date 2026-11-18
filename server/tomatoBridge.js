import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import { createHash } from 'crypto';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { logger } from './logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const execFileAsync = promisify(execFile);

const SOURCES = new Set([
  'all', 'anidb', 'aniwatch', 'gogoanime', '9anime', 'animeplanet',
  'anisearch', 'youtube', 'bilibili', 'miruro', 'animegg', 'hianime',
  'nyaa', 'tpb',
]);
const MODES = new Set(['sub', 'dub']);

const ACTIONS = new Set(['search', 'episodes', 'resolve', 'audio-modes', 'trending']);

const TTL_MS = {
  search: 10 * 60 * 1000,
  episodes: 60 * 60 * 1000,
  resolve: 5 * 60 * 1000,
  'audio-modes': 60 * 60 * 1000,
  trending: 30 * 60 * 1000,
};

const cache = new Map();
const inflight = new Map();

function isEnabled() {
  return process.env.TOMATOPLAY_ENABLED === '1';
}

function getBin() {
  const raw = process.env.TOMATOPLAY_BIN;
  if (raw) {
    return raw.startsWith('/') ? raw : join(__dirname, '..', raw);
  }
  return join(__dirname, 'vendor', 'tomato-play', 'tomatoplay');
}

function getTimeoutMs() {
  const value = Number(process.env.TOMATOPLAY_TIMEOUT_MS);
  return Number.isFinite(value) && value > 0 ? value : 30000;
}

function isAvailable() {
  return isEnabled() && existsSync(getBin());
}

function keyFor(action, args) {
  return createHash('sha1').update(action + '\0' + args.join('\0')).digest('hex');
}

function getCached(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expires) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

function setCached(key, action, value) {
  cache.set(key, { value, expires: Date.now() + (TTL_MS[action] || 10 * 60 * 1000) });
}

function fail(stage, error) {
  const err = new Error(error);
  err.stage = stage;
  return err;
}

function parseTomatoJson(text, action) {
  const trimmed = String(text).trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start === -1 || end <= start) throw fail(action, 'malformed JSON output');
  let data;
  try {
    data = JSON.parse(trimmed.slice(start, end + 1));
  } catch {
    throw fail(action, 'malformed JSON output');
  }
  if (data.ok !== true) throw fail(data.stage || action, data.error || 'request failed');
  if (data.version !== 1) throw fail(action, 'unsupported tomato-play JSON version');
  return data;
}

function runProcess(args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn('bash', [getBin(), '--json', ...args], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGTERM');
      reject(fail(args[0] || '', 'tomato-play timed out'));
    }, getTimeoutMs());

    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        const err = fail(args[0] || '', `tomato-play exited with code ${code}`);
        err.stdout = stdout;
        err.stderr = stderr;
        reject(err);
      } else {
        resolve(stdout);
      }
    });

    if (input) child.stdin.write(input);
    child.stdin.end();
  });
}

function validateArgs(action, args) {
  if (!ACTIONS.has(action)) throw fail('', `unknown action: ${action}`);

  const clean = Array.isArray(args) ? args.map(a => String(a ?? '').trim()) : [];

  switch (action) {
    case 'search': {
      const query = clean[0];
      if (!query) throw fail('search', 'missing query');
      if (query.length > 120) throw fail('search', 'query too long');
      const source = clean[1] || 'all';
      if (!SOURCES.has(source)) throw fail('search', `unknown source: ${source}`);
      return [query, source];
    }
    case 'episodes': {
      const [source, id] = clean;
      if (!source || !id) throw fail('episodes', 'missing source or id');
      if (!SOURCES.has(source) || source === 'all') throw fail('episodes', `unknown source: ${source}`);
      if (id.length > 200) throw fail('episodes', 'id too long');
      return [source, id];
    }
    case 'resolve': {
      const [source, id, ep, mode] = clean;
      if (!source || !id || !ep) throw fail('resolve', 'missing arguments');
      if (!SOURCES.has(source) || source === 'all') throw fail('resolve', `unknown source: ${source}`);
      if (id.length > 200 || ep.length > 200) throw fail('resolve', 'argument too long');
      if (mode && !MODES.has(mode)) throw fail('resolve', `unknown mode: ${mode}`);
      return [source, id, ep, mode || 'sub'];
    }
    case 'audio-modes': {
      const [source, id, ep] = clean;
      if (!source || !id || !ep) throw fail('audio-modes', 'missing arguments');
      if (!SOURCES.has(source) || source === 'all') throw fail('audio-modes', `unknown source: ${source}`);
      return [source, id, ep];
    }
    case 'trending':
      return [];
    default:
      throw fail('', `unknown action: ${action}`);
  }
}

async function runJson(action, args) {
  const clean = validateArgs(action, args);
  if (!isEnabled()) throw fail('', 'tomato-play integration disabled');
  if (!existsSync(getBin())) throw fail('', 'tomato-play not found');
  const key = keyFor(action, clean);
  const cached = getCached(key);
  if (cached) return cached;
  if (inflight.has(key)) return inflight.get(key);

  const request = (async () => {
    try {
      const { stdout } = await execFileAsync('bash', [getBin(), '--json', action, ...clean], {
        timeout: getTimeoutMs(),
        maxBuffer: 8 * 1024 * 1024,
      });
      const data = parseTomatoJson(stdout, action);
      setCached(key, action, data);
      return data;
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, request);
  return request;
}

export function tomatoStatus() {
  return {
    enabled: isEnabled(),
    available: isAvailable(),
    bin: getBin(),
  };
}

export async function tomatoSearch(query, source = 'all') {
  return runJson('search', [query, source]);
}

export async function tomatoEpisodes(source, id) {
  return runJson('episodes', [source, id]);
}

export async function tomatoResolve(source, id, episodeKey, mode = 'sub') {
  return runJson('resolve', [source, id, episodeKey, mode]);
}

export async function tomatoAudioModes(source, id, episode) {
  return runJson('audio-modes', [source, id, episode]);
}

export async function tomatoTrending() {
  return runJson('trending', []);
}

export async function tomatoProbe(results) {
  const clean = (Array.isArray(results) ? results : []).slice(0, 200).map((entry) => ({
    source: String(entry?.source || '').trim().slice(0, 40),
    id: String(entry?.id || '').trim().slice(0, 200),
    title: String(entry?.title || '').trim().slice(0, 200),
  })).filter((entry) => entry.source && entry.id);
  if (clean.length === 0) return [];

  if (!isEnabled()) throw fail('', 'tomato-play integration disabled');
  if (!existsSync(getBin())) throw fail('', 'tomato-play not found');

  const tsv = `${clean.map((entry) => `${entry.source}:${entry.id}\t${entry.title}`).join('\n')}\n`;
  const key = `probe:${createHash('sha1').update(tsv).digest('hex')}`;
  const cached = getCached(key);
  if (cached) return cached;
  if (inflight.has(key)) return inflight.get(key);

  const request = (async () => {
    try {
      const stdout = await runProcess(['probe'], tsv);
      const data = parseTomatoJson(stdout, 'probe');
      const playable = Array.isArray(data.results) ? data.results : [];
      setCached(key, 'probe', playable);
      return playable;
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, request);
  return request;
}

export function logTomatoStatus() {
  const status = tomatoStatus();
  if (!status.enabled) {
    logger.info('tomato-play integration disabled (TOMATOPLAY_ENABLED!=1)');
  } else if (!status.available) {
    logger.warn(`tomato-play integration enabled but binary not found: ${status.bin}`);
  } else {
    logger.info(`tomato-play integration ready: ${status.bin}`);
  }
}
