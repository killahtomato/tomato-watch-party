import { verifyHostToken } from './auth.js';
import {
  getPlaybackState,
  playMovie,
  pausePlayback,
  resumePlayback,
  seekPlayback,
  endPlayback,
  updateHostPosition,
  isStreamActive,
  getCurrentMovie,
} from './streamManager.js';
import { logger } from './logger.js';

const users = new Map();
const chatHistory = [];
const MAX_CHAT_HISTORY = 200;

const throwCooldowns = new Map();
const THROW_COOLDOWN_MS = 12000;
const THROW_LIMIT = 5;
const throwCounts = new Map();

let hostSocketId = null;
let lastSeekBroadcast = 0;

export function setupSocketHandlers(io) {
  const broadcastInterval = setInterval(() => {
    if (isStreamActive()) {
      io.emit('playbackUpdate', getPlaybackState());
    }
  }, 1000);

  io.on('connection', (socket) => {
    logger.info(`Client connected: ${socket.id} (transport: ${socket.conn.transport.name})`);

    socket.on('join', (data) => {
      const name = (data?.name || 'Anonymous').slice(0, 24).trim();
      users.set(socket.id, {
        id: socket.id,
        name: name || 'Anonymous',
        joinedAt: Date.now(),
      });

      const state = getPlaybackState();
      socket.emit('joined', {
        userId: socket.id,
        playbackState: state,
        chatHistory,
        viewerCount: users.size,
      });

      logger.info(`Join from ${socket.id} (${name}) — stream active: ${isStreamActive()}, playing: ${state.isPlaying}`);
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

      logger.debug(`Chat from ${user.name}: ${text}`);
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
      logger.debug(`Throw from ${user.name}: ${item}`);
      io.emit('throw', {
        id: Date.now() + '-' + socket.id,
        name: user.name,
        item: item === 'popcorn' ? 'popcorn' : 'tomato',
        side: Math.random() > 0.5 ? 'left' : 'right',
      });
    });

    socket.on('host:sync', (data) => {
      if (!isHostSocket(socket)) return;
      if (typeof data?.position === 'number') {
        updateHostPosition(data.position);
        logger.debug(`Host sync: ${data.position.toFixed(1)}s`);
      }
    });

    socket.on('host:playMovie', async (data, callback) => {
      if (!isHostSocket(socket)) {
        logger.warn(`Unauthorized play attempt from ${socket.id}`);
        return callback?.({ error: 'Unauthorized' });
      }

      try {
        const state = await playMovie(data.movie);
        logger.info(`Host playing: ${data.movie}`);
        io.emit('playbackUpdate', state);
        callback?.({ success: true, state });
      } catch (err) {
        logger.error(`Play failed: ${err.message}`);
        callback?.({ error: err.message });
      }
    });

    socket.on('host:pause', (_data, callback) => {
      if (!isHostSocket(socket)) return callback?.({ error: 'Unauthorized' });
      logger.info('Host paused');
      pausePlayback();
      io.emit('playbackUpdate', getPlaybackState());
      callback?.({ success: true, state: getPlaybackState() });
    });

    socket.on('host:resume', (_data, callback) => {
      if (!isHostSocket(socket)) return callback?.({ error: 'Unauthorized' });
      logger.info('Host resumed');
      resumePlayback();
      io.emit('playbackUpdate', getPlaybackState());
      callback?.({ success: true, state: getPlaybackState() });
    });

    socket.on('host:seek', (data, callback) => {
      if (!isHostSocket(socket)) return callback?.({ error: 'Unauthorized' });
      logger.info(`Host seek to: ${data.time}`);
      seekPlayback(data.time);
      const now = Date.now();
      if (now - lastSeekBroadcast > 500) {
        lastSeekBroadcast = now;
        io.emit('playbackUpdate', getPlaybackState());
      }
      callback?.({ success: true, state: getPlaybackState() });
    });

    socket.on('host:ended', (_data, callback) => {
      if (!isHostSocket(socket)) return callback?.({ error: 'Unauthorized' });
      if (!isStreamActive()) return callback?.({ success: true });
      logger.info('Movie ended');
      const state = endPlayback();
      io.emit('playbackUpdate', state);
      callback?.({ success: true, state });
    });

    socket.on('host:authenticate', (data, callback) => {
      if (verifyHostToken(data.token)) {
        if (hostSocketId && hostSocketId !== socket.id) {
          io.to(hostSocketId).emit('host:revoked');
          logger.info(`Revoked host from ${hostSocketId}, new host: ${socket.id}`);
        }

        socket.data.isHost = true;
        hostSocketId = socket.id;
        logger.info(`Host authenticated: ${socket.id}`);

        if (isStreamActive()) {
          logger.info(`Host reconnected — stream already active: ${getCurrentMovie()}`);
        }

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

      if (socket.id === hostSocketId) {
        hostSocketId = null;
        logger.info(`Host disconnected — stream continues for audience`);
      }

      users.delete(socket.id);
      io.emit('viewerCount', users.size);
    });
  });

  io.on('disconnect', () => {
    clearInterval(broadcastInterval);
  });
}

function isHostSocket(socket) {
  return socket.data?.isHost === true && socket.id === hostSocketId;
}
