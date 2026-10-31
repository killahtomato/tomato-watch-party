import { verifyHostToken } from './auth.js';
import {
  getPlaybackState,
  playMovie,
  pausePlayback,
  resumePlayback,
  seekPlayback,
  endPlayback,
  changeQuality,
  updateHostPosition,
  isStreamActive,
  getCurrentMovie,
} from './streamManager.js';
import { logger } from './logger.js';
import { setIoRef } from './streamManager.js';

const users = new Map();
const chatHistory = [];
const MAX_CHAT_HISTORY = 200;

const throwCooldowns = new Map();
const viewerHealth = new Map();

let hostSocketId = null;
let lastSeekBroadcast = 0;
let reactionsEnabled = true;

export function setupSocketHandlers(io) {
  setIoRef(io);

  const broadcastInterval = setInterval(() => {
    if (isStreamActive()) {
      io.emit('playbackUpdate', getPlaybackState());
    }
  }, 3000);

  io.on('connection', (socket) => {
    logger.info(`Client connected: ${socket.id} (transport: ${socket.conn.transport.name})`);

    socket.on('join', (data) => {
      const name = (data?.name || 'Anonymous').slice(0, 24).trim();
      const finalName = name || 'Anonymous';

      const nameLower = finalName.toLowerCase();
      const isDuplicate = [...users.values()].some(u => u.name.toLowerCase() === nameLower);
      if (isDuplicate) {
        logger.info(`Duplicate name rejected: ${finalName} from ${socket.id}`);
        return socket.emit('join:error', { error: 'Name already taken' });
      }

      const side = Math.random() > 0.5 ? 'left' : 'right';
      users.set(socket.id, {
        id: socket.id,
        name: finalName,
        joinedAt: Date.now(),
        side,
        isHost: !!socket.data.isHost,
      });
      if (socket.data.isHost) {
        hostSocketId = socket.id;
      }

      const state = getPlaybackState();
      socket.emit('joined', {
        userId: socket.id,
        playbackState: state,
        chatHistory,
        viewerCount: users.size,
      });

      logger.info(`Join from ${socket.id} (${finalName}) — stream active: ${isStreamActive()}, playing: ${state.isPlaying}`);

      const joinMsg = {
        id: Date.now() + '-join-' + socket.id,
        type: 'system',
        text: `${finalName} joined the watch party! 🎉`,
        timestamp: Date.now(),
      };
      chatHistory.push(joinMsg);
      if (chatHistory.length > MAX_CHAT_HISTORY) chatHistory.shift();
      io.emit('chat:system', joinMsg);

      socket.data.isHost = false;
      io.emit('viewerCount', users.size);
      broadcastUsersList(io);
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
        isHost: !!user.isHost,
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

      const item = data?.item === 'popcorn' ? 'popcorn' : 'tomato';
      const now = Date.now();
      const key = socket.id;

      if (!throwCooldowns.has(key)) {
        throwCooldowns.set(key, {
          tomato: { count: 0, resetAt: now + 30000 },
          popcorn: { count: 0, resetAt: now + 30000 },
        });
      }
      const tc = throwCooldowns.get(key);
      const itemState = tc[item];

      if (now > itemState.resetAt) {
        itemState.count = 0;
        itemState.resetAt = now + 30000;
      }

      if (itemState.count >= 3) {
        const remaining = itemState.resetAt - now;
        logger.debug(`Throw cooldown: ${user.name} ${item} (${remaining}ms remaining)`);
        socket.emit('throw:cooldown', { item, remainingMs: remaining });
        return;
      }

      itemState.count++;
      logger.debug(`Throw from ${user.name}: ${item} (${itemState.count}/3)`);

      io.emit('throw', {
        id: Date.now() + '-' + socket.id,
        name: user.name,
        item,
        throwerId: socket.id,
        throwerSide: user.side,
      });

      const getInfo = (it) => {
        const s = throwCooldowns.get(key)[it];
        return { remaining: Math.max(0, s.resetAt - Date.now()), count: s.count };
      };

      socket.emit('throw:ack', {
        tomato: getInfo('tomato'),
        popcorn: getInfo('popcorn'),
      });
    });

    socket.on('reaction', (data) => {
      if (!isStreamActive() || !reactionsEnabled) return;
      const user = users.get(socket.id);
      if (!user) return;

      io.emit('reaction', {
        id: Date.now() + '-' + socket.id,
        name: user.name,
        emoji: data.emoji || '👏',
        throwerId: socket.id,
        throwerSide: user.side,
      });
    });

    socket.on('ping:measure', (data, callback) => {
      callback({ timestamp: data?.timestamp, serverTime: Date.now() });
    });

    socket.on('viewer:health', (data) => {
      viewerHealth.set(socket.id, {
        bufferHealth: data?.bufferHealth || 0,
        drift: data?.drift || 0,
        updatedAt: Date.now(),
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
        const state = await playMovie(data.movie, data.quality);
        logger.info(`Host playing: ${data.movie} (${state.quality})`);
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

    socket.on('host:forceQuality', (data, callback) => {
      if (!isHostSocket(socket)) return callback?.({ error: 'Unauthorized' });
      const quality = data.quality || '1080p';

      if (data.targetUserId) {
        logger.info(`Quality forced: ${quality} for ${data.targetUserId}`);
        io.to(data.targetUserId).emit('forceQuality', { quality, forcedBy: 'host' });
        io.emit('quality:forced', { targetUserId: data.targetUserId, quality, isAll: false });
      } else {
        logger.info(`Quality forced: ${quality} for all viewers`);
        io.emit('forceQuality', { quality, forcedBy: 'host' });
        io.emit('quality:forced', { quality, isAll: true });
      }

      callback?.({ success: true });
    });

    socket.on('host:authenticate', (data, callback) => {
      if (verifyHostToken(data.token)) {
        if (hostSocketId && hostSocketId !== socket.id) {
          io.to(hostSocketId).emit('host:revoked');
          logger.info(`Revoked host from ${hostSocketId}, new host: ${socket.id}`);
        }

        socket.data.isHost = true;
        hostSocketId = socket.id;
        const user = users.get(socket.id);
        if (user) user.isHost = true;
        logger.info(`Host authenticated: ${socket.id}`);

        if (isStreamActive()) {
          logger.info(`Host reconnected — stream already active: ${getCurrentMovie()}`);
        }

        callback?.({ success: true });
        broadcastUsersList(io);
      } else {
        logger.warn(`Host auth failed: ${socket.id}`);
        callback?.({ error: 'Invalid token' });
      }
    });

    socket.on('disconnect', () => {
      const user = users.get(socket.id);
      if (user) {
        logger.info(`User disconnected: ${user.name} (${socket.id})`);

        const leaveMsg = {
          id: Date.now() + '-leave-' + socket.id,
          type: 'system',
          text: `${user.name} left the watch party`,
          timestamp: Date.now(),
        };
        chatHistory.push(leaveMsg);
        if (chatHistory.length > MAX_CHAT_HISTORY) chatHistory.shift();
        io.emit('chat:system', leaveMsg);
      }

      if (socket.id === hostSocketId) {
        hostSocketId = null;
        logger.info(`Host disconnected — stream continues for audience`);
      }
      users.delete(socket.id);
      viewerHealth.delete(socket.id);
      io.emit('viewerCount', users.size);
      broadcastUsersList(io);
    });

    socket.on('host:reactions:toggle', (data, callback) => {
      if (!isHostSocket(socket)) return callback?.({ error: 'Unauthorized' });
      reactionsEnabled = data.enabled !== false;
      io.emit('reactions:enabled', reactionsEnabled);
      logger.info(`Reactions ${reactionsEnabled ? 'enabled' : 'disabled'} by host`);
      callback?.({ success: true, enabled: reactionsEnabled });
    });
  });

  io.on('disconnect', () => {
    clearInterval(broadcastInterval);
  });
}

function isHostSocket(socket) {
  return socket.data?.isHost === true && socket.id === hostSocketId;
}

function broadcastUsersList(io) {
  io.emit('users:list', [...users.values()].map(u => {
    const health = viewerHealth.get(u.id);
    return {
      id: u.id,
      name: u.name,
      side: u.side,
      isHost: u.isHost,
      bufferHealth: health?.bufferHealth || null,
      drift: health?.drift || null,
    };
  }));
}
