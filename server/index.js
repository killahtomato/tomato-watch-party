import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { setupSocketHandlers } from './socketHandlers.js';
import { authenticateHost, verifyHostPassword } from './auth.js';
import {
  getMovieList,
  getMovieDir,
  getStreamDir,
  getStreamPath,
  initCache,
  remuxForTracks,
  safeJoin,
  isValidQuality,
  isSafeName,
  STREAM_DIR,
} from './streamManager.js';
import { getAudioFileList } from './djManager.js';
import { existsSync, mkdirSync, readFileSync } from 'fs';
import { logger } from './logger.js';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '..', '.env') });

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*' },
});

app.use(cors());
app.use(express.json());
app.use(express.static(join(__dirname, '..', 'client', 'dist')));

const loginAttempts = new Map();

function isRateLimited(key, max = 5, windowMs = 60000) {
  const now = Date.now();
  const entry = loginAttempts.get(key) || { count: 0, resetAt: now + windowMs };
  if (now > entry.resetAt) {
    entry.count = 0;
    entry.resetAt = now + windowMs;
  }
  entry.count++;
  loginAttempts.set(key, entry);
  return entry.count > max;
}

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
  if (isRateLimited(`host:${req.ip}`)) {
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
  if (isRateLimited(`dj:${req.ip}`)) {
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

app.get('/api/audio-file/:track', (req, res) => {
  let trackName;
  try {
    trackName = decodeURIComponent(req.params.track);
  } catch {
    return res.status(400).json({ error: 'Invalid track name' });
  }
  if (!isSafeName(trackName)) return res.status(400).json({ error: 'Invalid track name' });

  const trackPath = safeJoin(getMovieDir(), trackName);
  if (!existsSync(trackPath)) return res.status(404).json({ error: 'Not found' });
  res.sendFile(trackPath);
});

await initCache();
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
httpServer.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
});
