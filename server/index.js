import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { setupSocketHandlers } from './socketHandlers.js';
import { authenticateHost, verifyHostPassword } from './auth.js';
import {
  getMovieList,
  getMovieDir,
  getMusicDir,
  getStreamDir,
  getStreamPath,
  initCache,
  remuxForTracks,
  safeJoin,
  isValidQuality,
  isSafeName,
  STREAM_DIR,
} from './streamManager.js';
import { getAudioFileList, isSafeRelativePath, ensureTrackCover } from './djManager.js';
import { getOrder } from './orderStore.js';
import { handleWebStream } from './webProxy.js';
import { logTomatoStatus } from './tomatoBridge.js';
import { existsSync, mkdirSync, readFileSync } from 'fs';
import { logger } from './logger.js';
import { migrateLegacyStateFiles } from './migrateDataDir.js';
import { initPersistence } from './persistence.js';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '..', '.env') });

const app = express();
const httpServer = createServer(app);

const ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  ...(process.env.ALLOWED_ORIGINS || '').split(',').map(o => o.trim()).filter(Boolean),
];

function isAllowedOrigin(origin) {
  if (!origin) return true;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  return /^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/.test(origin);
}

function isSameOrigin(origin, req) {
  const host = req.headers.host;
  if (!host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

function isOriginAllowed(origin, req) {
  return isAllowedOrigin(origin) || isSameOrigin(origin, req);
}

const io = new Server(httpServer, {
  allowRequest(req, callback) {
    const origin = req.headers.origin;
    if (isOriginAllowed(origin, req)) return callback(null, true);
    return callback('Origin not allowed', false);
  },
});

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && isOriginAllowed(origin, req)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Vary', 'Origin');
  }
  if (req.method === 'OPTIONS') {
    return res.sendStatus(origin && isOriginAllowed(origin, req) ? 204 : 403);
  }
  next();
});
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});
app.use(express.json());

const MOBILE_DIST = join(__dirname, '..', 'mobile', 'dist');
const MOBILE_UA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|CriOS|FxiOS/i;

function parseCookies(req) {
  const header = req.headers.cookie;
  const cookies = {};
  if (!header) return cookies;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx > -1) cookies[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return cookies;
}

app.use((req, res, next) => {
  if (req.method !== 'GET') return next();
  const path = req.path;
  if (
    path.startsWith('/m') ||
    path.startsWith('/api') ||
    path.startsWith('/stream') ||
    path.startsWith('/socket.io') ||
    path.startsWith('/assets')
  ) {
    return next();
  }
  if (path !== '/' && path !== '/index.html') return next();

  if (req.query.desktop === '1') {
    res.setHeader('Set-Cookie', 'desktop=1; Path=/; Max-Age=31536000; SameSite=Lax');
  }
  const wantsDesktop = req.query.desktop === '1' || parseCookies(req).desktop === '1';
  const isMobile = MOBILE_UA.test(req.headers['user-agent'] || '');

  if (isMobile && !wantsDesktop) {
    return res.redirect('/m');
  }
  next();
});

app.use(express.static(join(__dirname, '..', 'client', 'dist')));
app.use('/m', express.static(MOBILE_DIST));
app.get('/m', (req, res) => res.sendFile(join(MOBILE_DIST, 'index.html')));

const loginAttempts = new Map();
const LOGIN_RATE_MAX = 5;
const LOGIN_RATE_WINDOW_MS = 60000;

function getClientKey(req) {
  const isLoopback = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.ip);
  if (isLoopback) {
    const cf = req.headers['cf-connecting-ip'];
    if (cf) return String(cf).split(',')[0].trim();
    const xff = req.headers['x-forwarded-for'];
    if (xff) return String(xff).split(',')[0].trim();
  }
  return req.ip || 'unknown';
}

function isRateLimited(req, prefix) {
  const key = `${prefix}:${getClientKey(req)}`;
  const now = Date.now();
  const entry = loginAttempts.get(key) || { count: 0, resetAt: now + LOGIN_RATE_WINDOW_MS };
  if (now > entry.resetAt) {
    entry.count = 0;
    entry.resetAt = now + LOGIN_RATE_WINDOW_MS;
  }
  entry.count++;
  loginAttempts.set(key, entry);
  return entry.count > LOGIN_RATE_MAX;
}

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of loginAttempts) {
    if (now > entry.resetAt) loginAttempts.delete(key);
  }
}, LOGIN_RATE_WINDOW_MS).unref();

app.use('/stream', (req, res, next) => {
  let path;
  try {
    path = decodeURIComponent(req.url.split('?')[0]);
  } catch {
    return res.status(400).end();
  }

  const match = path.match(/^\/([^/]+)\/(1080p|720p|480p)\.mp4$/);
  if (!match) return res.status(404).end();

  const movieName = match[1];
  const quality = match[2];

  let requestedPath;
  try {
    requestedPath = getStreamPath(movieName, quality);
  } catch {
    return res.status(404).end();
  }

  if (!existsSync(requestedPath)) {
    try {
      const fallbackPath = getStreamPath(movieName, '1080p');
      if (existsSync(fallbackPath)) {
        logger.debug(`Fallback: ${quality} -> 1080p for ${movieName}`);
        return res.sendFile(fallbackPath);
      }
    } catch {}
    return res.status(404).end();
  }

  next();
});

app.use('/stream', express.static(getStreamDir()));

app.get('/api/movies', async (req, res) => {
  res.json(await getMovieList());
});

app.post('/api/host/login', (req, res) => {
  if (isRateLimited(req, 'host')) {
    return res.status(429).json({ error: 'Too many attempts' });
  }
  if (verifyHostPassword(req.body?.password)) {
    const token = authenticateHost();
    res.json({ token });
  } else {
    res.status(401).json({ error: 'Invalid password' });
  }
});

app.post('/api/dj/login', (req, res) => {
  if (isRateLimited(req, 'dj')) {
    return res.status(429).json({ error: 'Too many attempts' });
  }
  if (verifyHostPassword(req.body?.password)) {
    const token = authenticateHost({ room: 'dj' });
    res.json({ token });
  } else {
    res.status(401).json({ error: 'Invalid password' });
  }
});

app.get('/api/audio-files', async (req, res) => {
  const tracks = await getAudioFileList();
  res.json(tracks);
});

app.get('/api/order/:room', (req, res) => {
  const room = req.params.room === 'dj' ? 'dj' : req.params.room === 'movie' ? 'movie' : null;
  if (!room) return res.status(400).json({ error: 'Invalid room' });
  res.json({ order: getOrder(room) });
});

app.get('/api/audio-file/:track', (req, res) => {
  let trackName;
  try {
    trackName = decodeURIComponent(req.params.track);
  } catch {
    return res.status(400).json({ error: 'Invalid track name' });
  }
  if (!isSafeRelativePath(trackName)) return res.status(400).json({ error: 'Invalid track name' });

  const trackPath = safeJoin(getMusicDir(), trackName);
  if (!existsSync(trackPath)) return res.status(404).json({ error: 'Not found' });
  res.sendFile(trackPath);
});

app.get('/api/audio-art/:track', async (req, res) => {
  let trackName;
  try {
    trackName = decodeURIComponent(req.params.track);
  } catch {
    return res.status(400).json({ error: 'Invalid track name' });
  }
  try {
    const artPath = await ensureTrackCover(trackName);
    if (!artPath) return res.status(404).json({ error: 'No cover art' });
    res.type(artPath.endsWith('.png') ? 'image/png' : 'image/jpeg');
    res.sendFile(artPath);
  } catch {
    res.status(404).json({ error: 'Not found' });
  }
});

app.get('/api/web/stream', handleWebStream);

await initCache();
logTomatoStatus();
setupSocketHandlers(io);

app.get('/api/movie/:name/tracks', async (req, res) => {
  let movieName;
  try {
    movieName = decodeURIComponent(req.params.name);
  } catch {
    return res.status(400).json({ error: 'Invalid movie name' });
  }
  if (!isSafeName(movieName)) return res.status(400).json({ error: 'Invalid movie name' });

  const moviePath = safeJoin(getMovieDir(), movieName);
  if (!existsSync(moviePath)) return res.status(404).json({ error: 'Not found' });

  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'error',
      '-show_entries', 'stream=index,codec_type,codec_name:stream_tags=language,title',
      '-of', 'json',
      moviePath,
    ]);
    const data = JSON.parse(stdout);
    const audio = (data.streams || []).filter(s => s.codec_type === 'audio');
    const subs = (data.streams || []).filter(s => s.codec_type === 'subtitle');
    res.json({ audio, subs });
  } catch (err) {
    logger.error(`Track probe failed for ${moviePath}: ${err.message}`);
    res.status(500).json({ error: 'Failed to inspect media' });
  }
});

app.get('/api/stream-file/:movie/:quality', async (req, res) => {
  let movieName;
  try {
    movieName = decodeURIComponent(req.params.movie);
  } catch {
    return res.status(400).json({ error: 'Invalid movie name' });
  }
  const quality = req.params.quality || '1080p';
  if (!isSafeName(movieName)) return res.status(400).json({ error: 'Invalid movie name' });
  if (!isValidQuality(quality)) return res.status(400).json({ error: 'Invalid quality' });

  const audioIdx = parseInt(req.query.audio) || 0;
  const subIdx = req.query.sub !== undefined ? parseInt(req.query.sub) : -1;

  try {
    const filePath = await remuxForTracks(movieName, quality, audioIdx, subIdx);
    res.sendFile(filePath);
  } catch (err) {
    logger.error(`Remux failed: ${err.message}`);
    try {
      const fallback = getStreamPath(movieName, quality);
      if (existsSync(fallback)) {
        return res.sendFile(fallback);
      }
    } catch {}
    res.status(500).json({ error: 'Failed to prepare stream' });
  }
});

const AUDIO_EXTRACT_DIR = join(STREAM_DIR, '_audio');
const SUB_EXTRACT_DIR = join(STREAM_DIR, '_subs');

function waitForFile(path, timeout = 1800000) {
  const start = Date.now();
  const metaPath = path + '.meta.json';
  return new Promise((resolve, reject) => {
    const check = () => {
      if (existsSync(path) && existsSync(metaPath)) {
        try {
          const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
          if (meta.complete) return resolve();
        } catch {}
      }
      if (Date.now() - start > timeout) return reject(new Error('Timeout waiting for transcoded file'));
      setTimeout(check, 500);
    };
    check();
  });
}

app.get('/api/audio/:movie/:quality/:index', async (req, res) => {
  let movieName;
  try {
    movieName = decodeURIComponent(req.params.movie);
  } catch {
    return res.status(400).json({ error: 'Invalid movie name' });
  }
  const quality = req.params.quality;
  const index = parseInt(req.params.index);

  if (!isSafeName(movieName)) return res.status(400).json({ error: 'Invalid movie name' });
  if (!isValidQuality(quality)) return res.status(400).json({ error: 'Invalid quality' });
  if (!Number.isInteger(index) || index < 0) return res.status(400).json({ error: 'Invalid track index' });

  const outDir = safeJoin(AUDIO_EXTRACT_DIR, movieName, quality);
  const outPath = safeJoin(outDir, `track_${index}.m4a`);

  if (!existsSync(outPath)) {
    mkdirSync(outDir, { recursive: true });
    const src = getStreamPath(movieName, quality);

    try {
      await waitForFile(src);
      await execFileAsync('ffmpeg', ['-y', '-i', src, '-map', `0:a:${index}`, '-c:a', 'copy', outPath]);
    } catch (err) {
      logger.error(`Audio extract failed: ${err.message}`);
      return res.status(500).json({ error: 'Failed to extract audio' });
    }
  }

  res.sendFile(outPath);
});

app.get('/api/subs/:movie/:quality/:index', async (req, res) => {
  let movieName;
  try {
    movieName = decodeURIComponent(req.params.movie);
  } catch {
    return res.status(400).json({ error: 'Invalid movie name' });
  }
  const quality = req.params.quality;
  const index = parseInt(req.params.index);

  if (!isSafeName(movieName)) return res.status(400).json({ error: 'Invalid movie name' });
  if (!isValidQuality(quality)) return res.status(400).json({ error: 'Invalid quality' });
  if (!Number.isInteger(index) || index < 0) return res.status(400).json({ error: 'Invalid track index' });

  const outDir = safeJoin(SUB_EXTRACT_DIR, movieName, quality);
  const outPath = safeJoin(outDir, `track_${index}.vtt`);

  if (!existsSync(outPath)) {
    mkdirSync(outDir, { recursive: true });
    const src = getStreamPath(movieName, quality);

    try {
      await waitForFile(src);
      await execFileAsync('ffmpeg', ['-y', '-i', src, '-map', `0:s:${index}`, outPath]);
    } catch (err) {
      logger.error(`Sub extract failed: ${err.message}`);
      return res.status(500).json({ error: 'Failed to extract subtitles' });
    }
  }

  res.type('text/vtt');
  res.sendFile(outPath);
});

const PORT = process.env.PORT || 3000;

await migrateLegacyStateFiles();
await initPersistence();

httpServer.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
});
