import { verifyHostToken } from './auth.js';
import {
  getPlaybackState,
  playMovie,
  pausePlayback,
  resumePlayback,
  seekPlayback,
} from './streamManager.js';

const users = new Map();
const chatHistory = [];
const MAX_CHAT_HISTORY = 200;

const throwCooldowns = new Map();
const THROW_COOLDOWN_MS = 12000;
const THROW_LIMIT = 5;
const throwCounts = new Map();

export function setupSocketHandlers(io) {
  io.on('connection', (socket) => {
    socket.on('join', (data) => {
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
      io.emit('throw', {
        id: Date.now() + '-' + socket.id,
        name: user.name,
        item: item === 'popcorn' ? 'popcorn' : 'tomato',
        side: Math.random() > 0.5 ? 'left' : 'right',
      });
    });

    socket.on('host:playMovie', async (data, callback) => {
      if (!verifyToken(socket)) return callback?.({ error: 'Unauthorized' });
      try {
        const state = await playMovie(data.movie);
        io.emit('playbackUpdate', state);
        callback?.({ success: true, state });
      } catch (err) {
        callback?.({ error: err.message });
      }
    });

    socket.on('host:pause', (_data, callback) => {
      if (!verifyToken(socket)) return callback?.({ error: 'Unauthorized' });
      pausePlayback().then((state) => {
        io.emit('playbackUpdate', state);
        callback?.({ success: true, state });
      });
    });

    socket.on('host:resume', (_data, callback) => {
      if (!verifyToken(socket)) return callback?.({ error: 'Unauthorized' });
      resumePlayback().then((state) => {
        io.emit('playbackUpdate', state);
        callback?.({ success: true, state });
      });
    });

    socket.on('host:seek', (data, callback) => {
      if (!verifyToken(socket)) return callback?.({ error: 'Unauthorized' });
      seekPlayback(data.time).then((state) => {
        io.emit('playbackUpdate', state);
        callback?.({ success: true, state });
      });
    });

    socket.on('host:authenticate', (data, callback) => {
      if (verifyHostToken(data.token)) {
        socket.data.isHost = true;
        callback?.({ success: true });
      } else {
        callback?.({ error: 'Invalid token' });
      }
    });

    socket.on('disconnect', () => {
      users.delete(socket.id);
      io.emit('viewerCount', users.size);
    });
  });
}

function verifyToken(socket) {
  return socket.data?.isHost === true;
}
