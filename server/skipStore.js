import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { STREAM_DIR } from './streamManager.js';
import { logger } from './logger.js';

const SKIP_FILE = join(STREAM_DIR, 'skip_profiles.json');
const MAX_ENTRIES = 500;
const MAX_TIME = 100000;

function readStore() {
  try {
    const data = JSON.parse(readFileSync(SKIP_FILE, 'utf8'));
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}

function writeStore(store) {
  mkdirSync(STREAM_DIR, { recursive: true });
  writeFileSync(SKIP_FILE, JSON.stringify(store, null, 2));
}

function normalizeSegment(segment) {
  if (!segment || typeof segment !== 'object') return null;
  const start = Number(segment.start);
  const end = Number(segment.end);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (start < 0 || end <= start || end > MAX_TIME) return null;
  return { start, end };
}

export function normalizeSkipProfile(skip) {
  if (!skip || typeof skip !== 'object') return null;
  const intro = normalizeSegment(skip.intro);
  const credits = normalizeSegment(skip.credits || skip.outro);
  if (!intro && !credits) return null;
  return { intro, credits };
}

export function getSkipProfile(showKey) {
  if (typeof showKey !== 'string' || showKey.length === 0) return null;
  return normalizeSkipProfile(readStore()[showKey]);
}

export function setSkipProfile(showKey, skip) {
  if (typeof showKey !== 'string' || showKey.length === 0) throw new Error('Invalid show key');
  const profile = normalizeSkipProfile(skip);
  const store = readStore();
  if (profile) {
    store[showKey] = profile;
  } else {
    delete store[showKey];
  }
  const keys = Object.keys(store);
  while (keys.length > MAX_ENTRIES) {
    delete store[keys.shift()];
  }
  try {
    writeStore(store);
  } catch (err) {
    logger.error(`Failed to save skip profiles: ${err.message}`);
    throw err;
  }
  return profile;
}
