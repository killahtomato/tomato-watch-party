import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { setupSocketHandlers } from './socketHandlers.js';
import { authenticateHost } from './auth.js';
import { getMovieList, getMovieDir, getStreamDir, getStreamPath, initCache, remuxForTracks, STREAM_DIR } from './streamManager.js';
import { getAudioFileList } from './djManager.js';
import { existsSync, mkdirSync, readFileSync } from 'fs';
import { logger } from './logger.js';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

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

app.use('/stream', express.static(getStreamDir(undefined)));

app.use('/stream', (req, res, next) => {
  const match = req.url.match(/\/([^\/]+)\/(1080p|720p|480p)\.mp4$/);
  if (!match) return next();

  const movieName = match[1];
  const quality = match[2];
  const requestedPath = getStreamPath(decodeURIComponent(movieName), quality);

  if (!existsSync(requestedPath)) {
    const fallbackPath = getStreamPath(decodeURIComponent(movieName), '1080p');
    if (existsSync(fallbackPath)) {
      logger.debug(`Fallback: ${quality} -> 1080p for ${movieName}`);
      return res.sendFile(fallbackPath);
    }
  }

  next();
});

app.get('/api/movies', async (req, res) => {
  res.json(await getMovieList());
});

app.post('/api/host/login', (req, res) => {
  const { password } = req.body;
  if (password === process.env.HOST_PASSWORD) {
    const token = authenticateHost();
    res.json({ token });
  } else {
    res.status(401).json({ error: 'Invalid password' });
  }
});

app.post('/api/dj/login', (req, res) => {
  const { password } = req.body;
  if (password === process.env.HOST_PASSWORD) {
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
  const trackName = decodeURIComponent(req.params.track);
  const trackPath = join(getMovieDir(), trackName);
  if (!existsSync(trackPath)) return res.status(404).json({ error: 'Not found' });
  res.sendFile(trackPath);
});

  await initCache();
  setupSocketHandlers(io);

  app.get('/api/movie/:name/tracks', async (req, res) => {
    const movieName = decodeURIComponent(req.params.name);
    const movieDir = getMovieDir();
    const moviePath = join(movieDir, movieName);
    if (!existsSync(moviePath)) return res.status(404).json({ error: 'Not found' });

    try {
      const { stdout } = await execAsync(
        `ffprobe -v error -show_entries stream=index,codec_type,codec_name:stream_tags=language,title -of json "${moviePath}"`
      );
      const data = JSON.parse(stdout);
      const audio = (data.streams || []).filter(s => s.codec_type === 'audio');
      const subs = (data.streams || []).filter(s => s.codec_type === 'subtitle');
      res.json({ audio, subs });
    } catch (err) {
      logger.error(`Track probe failed for ${moviePath}: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/stream-file/:movie/:quality', async (req, res) => {
    const movieName = decodeURIComponent(req.params.movie);
    const quality = req.params.quality || '1080p';
    const audioIdx = parseInt(req.query.audio) || 0;
    const subIdx = req.query.sub !== undefined ? parseInt(req.query.sub) : -1;

    try {
      const filePath = await remuxForTracks(movieName, quality, audioIdx, subIdx);
      res.sendFile(filePath);
    } catch (err) {
      logger.error(`Remux failed: ${err.message}`);
      const fallback = getStreamPath(movieName, quality);
      if (existsSync(fallback)) {
        res.sendFile(fallback);
      } else {
        res.status(500).json({ error: err.message });
      }
    }
  });

  const PORT = process.env.PORT || 3000;
  httpServer.listen(PORT, () => {
    logger.info(`Server running on port ${PORT}`);
  });

  const AUDIO_EXTRACT_DIR = join(STREAM_DIR, '_audio');
  const SUB_EXTRACT_DIR = join(STREAM_DIR, '_subs');

  app.get('/api/audio/:movie/:quality/:index', async (req, res) => {
    const movieName = decodeURIComponent(req.params.movie);
    const quality = req.params.quality;
    const index = parseInt(req.params.index);

    const outDir = join(AUDIO_EXTRACT_DIR, movieName, quality);
    const outPath = join(outDir, `track_${index}.m4a`);

    if (!existsSync(outPath)) {
      mkdirSync(outDir, { recursive: true });
      const src = getStreamPath(movieName, quality);

      const waitForFile = async (path, timeout = 1800000) => {
        const start = Date.now();
        const metaPath = path + '.meta.json';
        while (true) {
          if (existsSync(path) && existsSync(metaPath)) {
            try {
              const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
              if (meta.complete) return;
            } catch {}
          }
          if (Date.now() - start > timeout) throw new Error('Timeout waiting for transcoded file');
          await new Promise(r => setTimeout(r, 500));
        }
      };

      try {
        await waitForFile(src);
        await execAsync(
          `ffmpeg -y -i "${src}" -map 0:a:${index} -c:a copy "${outPath}"`
        );
      } catch (err) {
        logger.error(`Audio extract failed: ${err.message}`);
        return res.status(500).json({ error: err.message });
      }
    }

    res.sendFile(outPath);
  });

  app.get('/api/subs/:movie/:quality/:index', async (req, res) => {
    const movieName = decodeURIComponent(req.params.movie);
    const quality = req.params.quality;
    const index = parseInt(req.params.index);

    const outDir = join(SUB_EXTRACT_DIR, movieName, quality);
    const outPath = join(outDir, `track_${index}.vtt`);

    if (!existsSync(outPath)) {
      mkdirSync(outDir, { recursive: true });
      const src = getStreamPath(movieName, quality);

      const waitForFile = async (path, timeout = 1800000) => {
        const start = Date.now();
        const metaPath = path + '.meta.json';
        while (true) {
          if (existsSync(path) && existsSync(metaPath)) {
            try {
              const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
              if (meta.complete) return;
            } catch {}
          }
          if (Date.now() - start > timeout) throw new Error('Timeout waiting for transcoded file');
          await new Promise(r => setTimeout(r, 500));
        }
      };

      try {
        await waitForFile(src);
        await execAsync(
          `ffmpeg -y -i "${src}" -map 0:s:${index} "${outPath}"`
        );
      } catch (err) {
        logger.error(`Sub extract failed: ${err.message}`);
        return res.status(500).json({ error: err.message });
      }
    }

    res.type('text/vtt');
    res.sendFile(outPath);
  });
