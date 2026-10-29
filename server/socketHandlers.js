import { verifyHostToken } from './auth.js';
import {
  getPlaybackState,
  playMovie,
  pausePlayback,
  resumePlayback,
  seekPlayback,
} from './streamManager.js';
import { logger } from './logger.js';

const users = new Map();
const chatHistory = [];
const MAX_CHAT_HISTORY = 200;

const throwCooldowns = new Map();
const THROW_COOLDOWN_MS = 12000;
const THROW_LIMIT = 5;
const throwCounts = new Map();

let lastSeekTime = 0;
let lastSeekBroadcast = 0;

export function setupSocketHandlers(io) {
  io.on('connection', (socket) => {
    logger.info(`Client connected: ${socket.id} (transport: ${socket.conn.transport.name})`);

    socket.on('join', (data) => {
      logger.info(`Join from ${socket.id}: ${JSON.stringify(data)}`);
      const name = (data?.name || 'Anonymous').slice(0, 24).trim();
      users.set(socket.id, {
        id: socket.id,
        name: name || 'Anonymous',
        joinedAt: Date.now(),
      });

      socket.emit('joined', {
        userId: socket.id,
        playbackState: getPlaybackState(),
        chatHistory,
        viewerCount: users.size,
      });

      io.emit('viewerCount', users.size);
    });

    socket.on('chat:message', (data) => {
      const user = users.get(socket.id);
      if (!user || !data?.text) return;

      const text = String(data.text).slice(0, 500).trim();
      if (!text) return;

      const message = {
        id: Date.now() + '-' + socket.id,
        name: user.name,
        text,
        timestamp: Date.now(),
      };

      chatHistory.push(message);
      if (chatHistory.length > MAX_CHAT_HISTORY) {
        chatHistory.shift();
      }

      logger.info(`Chat from ${user.name}: ${text}`);
      io.emit('chat:message', message);
    });

    socket.on('throw', (data) => {
      const user = users.get(socket.id);
      if (!user) return;

      const now = Date.now();
      const key = socket.id;

      if (!throwCounts.has(key)) {
        throwCounts.set(key, { count: 0, resetAt: now + 60000 });
      }
      const tc = throwCounts.get(key);
      if (now > tc.resetAt) {
        tc.count = 0;
        tc.resetAt = now + 60000;
      }
      if (tc.count >= THROW_LIMIT) return;
      tc.count++;

      if (throwCooldowns.has(key) && now - throwCooldowns.get(key) < THROW_COOLDOWN_MS) return;
      throwCooldowns.set(key, now);

      const item = data?.item || 'tomato';
      logger.info(`Throw from ${user.name}: ${item}`);
      io.emit('throw', {
        id: Date.now() + '-' + socket.id,
        name: user.name,
        item: item === 'popcorn' ? 'popcorn' : 'tomato',
        side: Math.random() > 0.5 ? 'left' : 'right',
      });
    });

    socket.on('host:playMovie', async (data, callback) => {
      if (!verifyToken(socket)) {
        logger.warn(`Unauthorized play attempt from ${socket.id}`);
        return callback?.({ error: 'Unauthorized' });
      }
      try {
        logger.info(`Host playing: ${data.movie}`);
        const state = await playMovie(data.movie);
        io.emit('playbackUpdate', state);
        callback?.({ success: true, state });
      } catch (err) {
        logger.error(`Play failed: ${err.message}`);
        callback?.({ error: err.message });
      }
    });

    socket.on('host:pause', (_data, callback) => {
      if (!verifyToken(socket)) return callback?.({ error: 'Unauthorized' });
      logger.info('Host paused');
      pausePlayback().then((state) => {
        io.emit('playbackUpdate', state);
        callback?.({ success: true, state });
      });
    });

    socket.on('host:resume', (_data, callback) => {
      if (!verifyToken(socket)) return callback?.({ error: 'Unauthorized' });
      logger.info('Host resumed');
      resumePlayback().then((state) => {
        io.emit('playbackUpdate', state);
        callback?.({ success: true, state });
      });
    });

    socket.on('host:seek', (data, callback) => {
      if (!verifyToken(socket)) return callback?.({ error: 'Unauthorized' });
      logger.info(`Host seek to: ${data.time}`);
      lastSeekTime = data.time;
      seekPlayback(data.time).then((state) => {
        const now = Date.now();
        if (now - lastSeekBroadcast > 1000) {
          lastSeekBroadcast = now;
          io.emit('playbackUpdate', state);
        }
        callback?.({ success: true, state });
      });
    });

    socket.on('host:authenticate', (data, callback) => {
      if (verifyHostToken(data.token)) {
        socket.data.isHost = true;
        logger.info(`Host authenticated: ${socket.id}`);
        callback?.({ success: true });
      } else {
        logger.warn(`Host auth failed: ${socket.id}`);
        callback?.({ error: 'Invalid token' });
      }
    });

    socket.on('disconnect', () => {
      const user = users.get(socket.id);
      if (user) {
        logger.info(`User disconnected: ${user.name} (${socket.id})`);
      }
      users.delete(socket.id);
      io.emit('viewerCount', users.size);
    });
  });
}

function verifyToken(socket) {
  return socket.data?.isHost === true;
}
