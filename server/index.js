import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import { setupSocketHandlers } from './socketHandlers.js';
import { authenticateHost } from './auth.js';
import { getMovieList, getHlsDir } from './streamManager.js';

dotenv.config();

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*' },
});

app.use(cors());
app.use(express.json());
app.use(express.static('../client/dist'));
app.use('/hls', express.static(getHlsDir()));

app.get('/api/movies', (req, res) => {
  res.json(getMovieList());
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
  console.log(`Server running on port ${PORT}`);
});
