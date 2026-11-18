import { execFile } from 'child_process';
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
      const text = String(stdout).trim();
      const start = text.indexOf('{');
      const end = text.lastIndexOf('}');
      if (start === -1 || end <= start) throw fail(action, 'malformed JSON output');
      const data = JSON.parse(text.slice(start, end + 1));
      if (data.ok !== true) throw fail(data.stage || action, data.error || 'request failed');
      if (data.version !== 1) throw fail(action, 'unsupported tomato-play JSON version');
      setCached(key, action, data);
      return data;
    } catch (err) {
      if (err instanceof SyntaxError) throw fail(action, 'malformed JSON output');
      throw err;
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
