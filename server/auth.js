import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '..', '.env') });

const JWT_SECRET = process.env.JWT_SECRET;
const HOST_PASSWORD = process.env.HOST_PASSWORD;

for (const [name, value, bad] of [
  ['JWT_SECRET', JWT_SECRET, ['change-this-to-a-random-secret-key', 'movie-stream-secret-change-me']],
  ['HOST_PASSWORD', HOST_PASSWORD, ['changeme']],
]) {
  if (!value || bad.includes(value)) {
    throw new Error(`${name} is missing or still the default. Set a strong value in .env.`);
  }
}

export function authenticateHost(options = {}) {
  const room = options.room || 'movie';
  return jwt.sign({ role: 'host', room }, JWT_SECRET, { expiresIn: '12h' });
}

export function verifyHostToken(token, room = null) {
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'host') return false;
    if (room && decoded.room !== room) return false;
    return true;
  } catch {
    return false;
  }
}

export function verifyHostTokenForRoom(token, room) {
  return verifyHostToken(token, room);
}

export function verifyHostPassword(password) {
  const provided = Buffer.from(String(password ?? ''));
  const expected = Buffer.from(HOST_PASSWORD);
  return provided.length === expected.length && crypto.timingSafeEqual(provided, expected);
}
