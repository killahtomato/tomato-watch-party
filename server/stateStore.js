import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'fs';
import { join } from 'path';
import { getDataDir, isValidQuality } from './streamManager.js';
import { normalizeSkip } from './webManager.js';
import { MAX_CHAT_HISTORY } from './rooms.js';
import { logger } from './logger.js';

const STATE_FILE = join(getDataDir(), 'state.json');
const SCHEMA_VERSION = 1;

function clampTime(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return 0;
  return Math.round(num * 10) / 10;
}

function asBoolean(value, fallback = false) {
  return typeof value === 'boolean' ? value : fallback;
}

function cleanString(value, max = 400) {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

function cleanMessages(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((msg) => msg && typeof msg === 'object' && typeof msg.text === 'string')
    .slice(-MAX_CHAT_HISTORY)
    .map((msg) => ({
      id: cleanString(msg.id, 200),
      name: cleanString(msg.name, 100),
      text: cleanString(msg.text, 500),
      timestamp: clampTime(msg.timestamp),
      type: msg.type === 'system' ? 'system' : 'message',
      isHost: Boolean(msg.isHost),
    }));
}

export function sanitizeSnapshot(raw) {
  if (!raw || typeof raw !== 'object' || raw.version !== SCHEMA_VERSION) return null;

  const movie = raw.movie && typeof raw.movie === 'object' ? raw.movie : null;
  const dj = raw.dj && typeof raw.dj === 'object' ? raw.dj : null;
  const web = raw.web && typeof raw.web === 'object' ? raw.web : null;
  const chat = raw.chat && typeof raw.chat === 'object' ? raw.chat : {};

  return {
    version: SCHEMA_VERSION,
    movie: movie && cleanString(movie.movie)
      ? {
        movie: cleanString(movie.movie),
        quality: isValidQuality(movie.quality) ? movie.quality : '1080p',
        isPlaying: asBoolean(movie.isPlaying),
        currentTime: clampTime(movie.currentTime),
      }
      : null,
    dj: dj && cleanString(dj.track)
      ? {
        track: cleanString(dj.track),
        isPlaying: asBoolean(dj.isPlaying),
        currentTime: clampTime(dj.currentTime),
      }
      : null,
    web: web && cleanString(web.source) && cleanString(web.id)
      ? {
        source: cleanString(web.source, 40),
        id: cleanString(web.id, 200),
        episodeKey: cleanString(web.episodeKey, 200),
        episodeNumber: cleanString(web.episodeNumber, 40),
        mode: web.mode === 'dub' ? 'dub' : 'sub',
        title: cleanString(web.title, 200),
        showKey: cleanString(web.showKey, 200),
        isPlaying: asBoolean(web.isPlaying),
        currentTime: clampTime(web.currentTime),
        ...(normalizeSkip(web.skip) ? { skip: normalizeSkip(web.skip) } : {}),
      }
      : null,
    chat: {
      movie: cleanMessages(chat.movie),
      dj: cleanMessages(chat.dj),
    },
  };
}

export function readStateFile() {
  try {
    return sanitizeSnapshot(JSON.parse(readFileSync(STATE_FILE, 'utf8')));
  } catch {
    return null;
  }
}

export function writeStateFile(snapshot) {
  const clean = sanitizeSnapshot({ ...snapshot, version: SCHEMA_VERSION });
  if (!clean) throw new Error('Invalid state snapshot');
  mkdirSync(getDataDir(), { recursive: true });
  const tmp = `${STATE_FILE}.tmp`;
  writeFileSync(tmp, JSON.stringify(clean));
  renameSync(tmp, STATE_FILE);
  return clean;
}

export function statePath() {
  return STATE_FILE;
}

export function logStatePath() {
  logger.info(`Persistent state file: ${STATE_FILE}`);
}
