import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { STREAM_DIR, isSafeName } from './streamManager.js';
import { logger } from './logger.js';

const ORDER_FILE = join(STREAM_DIR, 'order.json');
const MAX_ITEMS = 1000;

function readStore() {
  try {
    const data = JSON.parse(readFileSync(ORDER_FILE, 'utf8'));
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}

export function getOrder(room) {
  if (room !== 'dj' && room !== 'movie') return [];
  const order = readStore()[room];
  if (!Array.isArray(order)) return [];
  return order.filter(name => typeof name === 'string' && isSafeName(name)).slice(0, MAX_ITEMS);
}

export function setOrder(room, names) {
  if (room !== 'dj' && room !== 'movie') throw new Error('Invalid room');
  if (!Array.isArray(names)) throw new Error('Invalid order');

  const clean = names
    .filter(name => typeof name === 'string' && isSafeName(name))
    .slice(0, MAX_ITEMS);

  const store = readStore();
  store[room] = clean;

  try {
    mkdirSync(STREAM_DIR, { recursive: true });
    writeFileSync(ORDER_FILE, JSON.stringify(store, null, 2));
  } catch (err) {
    logger.error(`Failed to save playback order: ${err.message}`);
    throw err;
  }

  return clean;
}
