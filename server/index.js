import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { setupSocketHandlers } from './socketHandlers.js';
import { authenticateHost } from './auth.js';
import { getMovieList, getHlsDir } from './streamManager.js';
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
app.use('/hls', express.static(getHlsDir()));

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

setupSocketHandlers(io);

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
});
