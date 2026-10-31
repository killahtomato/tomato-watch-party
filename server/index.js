import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { setupSocketHandlers } from './socketHandlers.js';
import { authenticateHost } from './auth.js';
import { getMovieList, getStreamDir, getStreamPath, initCache } from './streamManager.js';
import { existsSync } from 'fs';
import { logger } from './logger.js';

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

await initCache();
setupSocketHandlers(io);

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
});
