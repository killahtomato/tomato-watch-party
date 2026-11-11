import { verifyHostToken, verifyHostTokenForRoom } from './auth.js';
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
  getMovieList,
  isValidQuality,
} from './streamManager.js';
import {
  getPlaybackState as getDJState,
  playTrack,
  pausePlayback as djPause,
  resumePlayback as djResume,
  seekPlayback as djSeek,
  updateDJPosition,
  isDJActive,
  endPlayback as djEnd,
  getPlaylist,
} from './djManager.js';
import { logger } from './logger.js';
import { setIoRef } from './streamManager.js';
import { setOrder } from './orderStore.js';

const MAX_CHAT_HISTORY = 200;

const rooms = {
  movie: { users: new Map(), chatHistory: [], hostSocketId: null, reactionsEnabled: true },
  dj: { users: new Map(), chatHistory: [], hostSocketId: null, reactionsEnabled: true },
};

const throwCooldowns = new Map();
const viewerHealth = new Map();

let lastSeekBroadcast = 0;

function getRoom(socket) {
  return socket.data?.room || 'movie';
}

function getRoomState(room) {
  return rooms[room] || rooms.movie;
}

function isHostSocket(socket) {
  const room = getRoom(socket);
  return socket.data?.isHost === true && socket.id === getRoomState(room).hostSocketId;
}

function isDJHostSocket(socket) {
  return isHostSocket(socket) && getRoom(socket) === 'dj';
}

function broadcastToRoom(io, room, event, data) {
  const state = getRoomState(room);
  for (const userId of state.users.keys()) {
    io.to(userId).emit(event, data);
  }
}

function broadcastUsersList(io, room) {
  const state = getRoomState(room);
  const list = [...state.users.values()].map(u => {
    const health = viewerHealth.get(u.id);
    return {
      id: u.id,
      name: u.name,
      side: u.side,
      isHost: u.isHost,
      bufferHealth: health?.bufferHealth || null,
      drift: health?.drift || null,
    };
  });
  broadcastToRoom(io, room, 'users:list', list);
  broadcastToRoom(io, room, 'viewerCount', state.users.size);
}

export function setupSocketHandlers(io) {
  setIoRef(io);

  setInterval(() => {
    if (isStreamActive()) {
      broadcastToRoom(io, 'movie', 'playbackUpdate', getPlaybackState());
    }
  }, 3000);

  setInterval(() => {
    if (isDJActive()) {
      broadcastToRoom(io, 'dj', 'dj:playbackUpdate', getDJState());
    }
  }, 3000);

  io.on('connection', (socket) => {
    logger.info(`Client connected: ${socket.id} (transport: ${socket.conn.transport.name})`);

    socket.on('join', (data) => {
      const room = data?.room === 'dj' ? 'dj' : 'movie';
      const name = String(data?.name || 'Anonymous').slice(0, 24).trim();
      const finalName = name || 'Anonymous';

      const oldRoom = socket.data.room;
      if (oldRoom && oldRoom !== room) {
        const oldState = getRoomState(oldRoom);
        oldState.users.delete(socket.id);
        const leaveMsg = {
          id: Date.now() + '-leave-' + socket.id,
          type: 'system',
          text: `${finalName} left the ${oldRoom === 'dj' ? 'DJ' : 'watch'} party`,
          timestamp: Date.now(),
        };
        oldState.chatHistory.push(leaveMsg);
        if (oldState.chatHistory.length > MAX_CHAT_HISTORY) oldState.chatHistory.shift();
        broadcastToRoom(io, oldRoom, 'chat:system', leaveMsg);
        broadcastUsersList(io, oldRoom);
      }

      const state = getRoomState(room);
      const nameLower = finalName.toLowerCase();
      const isDuplicate = [...state.users.values()].some(u => u.name.toLowerCase() === nameLower);
      if (isDuplicate) {
        return socket.emit('join:error', { error: 'Name already taken' });
      }

      const side = Math.random() > 0.5 ? 'left' : 'right';
      state.users.set(socket.id, {
        id: socket.id,
        name: finalName,
        joinedAt: Date.now(),
        side,
        isHost: false,
        room,
      });

      socket.data.room = room;

      const playbackState = room === 'dj' ? getDJState() : getPlaybackState();
      socket.emit('joined', {
        userId: socket.id,
        room,
        playbackState,
        chatHistory: state.chatHistory,
        viewerCount: state.users.size,
      });

      logger.info(`Join from ${socket.id} (${finalName}) in ${room} room`);

      const joinMsg = {
        id: Date.now() + '-join-' + socket.id,
        type: 'system',
        text: `${finalName} joined the ${room === 'dj' ? 'DJ' : 'watch'} party!`,
        timestamp: Date.now(),
      };
      state.chatHistory.push(joinMsg);
      if (state.chatHistory.length > MAX_CHAT_HISTORY) state.chatHistory.shift();
      broadcastToRoom(io, room, 'chat:system', joinMsg);

      broadcastUsersList(io, room);
    });

    socket.on('chat:message', (data) => {
      const room = getRoom(socket);
      const state = getRoomState(room);
      const user = state.users.get(socket.id);
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

      state.chatHistory.push(message);
      if (state.chatHistory.length > MAX_CHAT_HISTORY) state.chatHistory.shift();

      broadcastToRoom(io, room, 'chat:message', message);
    });

    socket.on('throw', (data) => {
      const room = getRoom(socket);
      if (room !== 'movie') return;
      const state = getRoomState(room);
      const user = state.users.get(socket.id);
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
        socket.emit('throw:cooldown', { item, remainingMs: itemState.resetAt - now });
        return;
      }

      itemState.count++;
      broadcastToRoom(io, room, 'throw', {
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
      socket.emit('throw:ack', { tomato: getInfo('tomato'), popcorn: getInfo('popcorn') });
    });

    socket.on('reaction', (data) => {
      const room = getRoom(socket);
      if (room !== 'movie') return;
      const state = getRoomState(room);
      if (!state.reactionsEnabled) return;
      const user = state.users.get(socket.id);
      if (!user) return;

      const emoji = typeof data?.emoji === 'string' && data.emoji.length > 0
        ? data.emoji.slice(0, 32)
        : '\u{1F44F}';

      broadcastToRoom(io, room, 'reaction', {
        id: Date.now() + '-' + socket.id,
        name: user.name,
        emoji,
        throwerId: socket.id,
        throwerSide: user.side,
      });
    });

    socket.on('dj:reaction', (data) => {
      const room = getRoom(socket);
      if (room !== 'dj') return;
      const state = getRoomState(room);
      if (!state.reactionsEnabled) return;
      const user = state.users.get(socket.id);
      if (!user) return;

      const emoji = typeof data?.emoji === 'string' && data.emoji.length > 0
        ? data.emoji.slice(0, 32)
        : '\u{1F37E}';

      broadcastToRoom(io, room, 'dj:reaction', {
        id: Date.now() + '-' + socket.id,
        name: user.name,
        emoji,
        throwerId: socket.id,
        throwerSide: user.side,
      });
    });

    socket.on('ping:measure', (data, callback) => {
      callback({ timestamp: data?.timestamp, serverTime: Date.now() });
    });

    socket.on('viewer:health', (data) => {
      viewerHealth.set(socket.id, {
        bufferHealth: Number.isFinite(data?.bufferHealth) ? data.bufferHealth : 0,
        drift: Number.isFinite(data?.drift) ? data.drift : 0,
        pingMs: Number.isFinite(data?.pingMs) ? data.pingMs : 0,
        updatedAt: Date.now(),
      });
    });

    socket.on('host:sync', (data) => {
      if (!isHostSocket(socket) || getRoom(socket) !== 'movie') return;
      if (typeof data?.position === 'number') {
        updateHostPosition(data.position);
      }
    });

    socket.on('dj:sync', (data) => {
      if (!isDJHostSocket(socket)) return;
      if (typeof data?.position === 'number') {
        updateDJPosition(data.position);
      }
    });

    socket.on('host:playMovie', async (data, callback) => {
      if (!isHostSocket(socket) || getRoom(socket) !== 'movie') {
        return callback?.({ error: 'Unauthorized' });
      }
      if (typeof data?.movie !== 'string' || data.movie.length === 0) {
        return callback?.({ error: 'Invalid movie' });
      }
      try {
        const state = await playMovie(data.movie, data.quality);
        logger.info(`Host playing: ${data.movie}`);
        broadcastToRoom(io, 'movie', 'playbackUpdate', state);
        callback?.({ success: true, state });
      } catch (err) {
        callback?.({ error: err.message });
      }
    });

    socket.on('host:pause', (_data, callback) => {
      if (!isHostSocket(socket) || getRoom(socket) !== 'movie') return callback?.({ error: 'Unauthorized' });
      pausePlayback();
      broadcastToRoom(io, 'movie', 'playbackUpdate', getPlaybackState());
      callback?.({ success: true, state: getPlaybackState() });
    });

    socket.on('host:resume', (_data, callback) => {
      if (!isHostSocket(socket) || getRoom(socket) !== 'movie') return callback?.({ error: 'Unauthorized' });
      resumePlayback();
      broadcastToRoom(io, 'movie', 'playbackUpdate', getPlaybackState());
      callback?.({ success: true, state: getPlaybackState() });
    });

    socket.on('host:seek', (data, callback) => {
      if (!isHostSocket(socket) || getRoom(socket) !== 'movie') return callback?.({ error: 'Unauthorized' });
      if (typeof data?.time !== 'number' || !Number.isFinite(data.time) || data.time < 0) {
        return callback?.({ error: 'Invalid time' });
      }
      seekPlayback(data.time);
      const now = Date.now();
      if (now - lastSeekBroadcast > 500) {
        lastSeekBroadcast = now;
        broadcastToRoom(io, 'movie', 'playbackUpdate', getPlaybackState());
      }
      callback?.({ success: true, state: getPlaybackState() });
    });

    socket.on('host:ended', (_data, callback) => {
      if (!isHostSocket(socket) || getRoom(socket) !== 'movie') return callback?.({ error: 'Unauthorized' });
      if (!isStreamActive()) return callback?.({ success: true });
      const state = endPlayback();
      broadcastToRoom(io, 'movie', 'playbackUpdate', state);
      callback?.({ success: true, state });
    });

    socket.on('movie:setOrder', (data, callback) => {
      if (!isHostSocket(socket) || getRoom(socket) !== 'movie') return callback?.({ error: 'Unauthorized' });
      try {
        const order = setOrder('movie', data?.order);
        broadcastToRoom(io, 'movie', 'orderUpdate', { room: 'movie', order });
        callback?.({ success: true, order });
      } catch (err) {
        callback?.({ error: err.message });
      }
    });

    socket.on('host:forceQuality', (data, callback) => {
      if (!isHostSocket(socket) || getRoom(socket) !== 'movie') return callback?.({ error: 'Unauthorized' });
      const quality = data?.quality;
      if (!isValidQuality(quality)) return callback?.({ error: 'Invalid quality' });
      if (data.targetUserId !== undefined && typeof data.targetUserId !== 'string') {
        return callback?.({ error: 'Invalid target' });
      }
      if (data.targetUserId) {
        io.to(data.targetUserId).emit('forceQuality', { quality });
      } else {
        broadcastToRoom(io, 'movie', 'forceQuality', { quality });
      }
      callback?.({ success: true });
    });

    socket.on('host:qualityChange', (data) => {
      if (!isHostSocket(socket) || getRoom(socket) !== 'movie') return;
      if (!isValidQuality(data?.quality)) return;
      broadcastToRoom(io, 'movie', 'qualityChange', { quality: data.quality });
    });

    socket.on('dj:play', async (data, callback) => {
      if (!isDJHostSocket(socket)) return callback?.({ error: 'Unauthorized' });
      if (typeof data?.track !== 'string' || data.track.length === 0) {
        return callback?.({ error: 'Invalid track' });
      }
      try {
        const state = await playTrack(data.track);
        logger.info(`DJ playing: ${data.track}`);
        broadcastToRoom(io, 'dj', 'dj:playbackUpdate', state);
        broadcastToRoom(io, 'dj', 'dj:trackChange', { track: data.track });
        callback?.({ success: true, state });
      } catch (err) {
        callback?.({ error: err.message });
      }
    });

    socket.on('dj:pause', (_data, callback) => {
      if (!isDJHostSocket(socket)) return callback?.({ error: 'Unauthorized' });
      djPause();
      broadcastToRoom(io, 'dj', 'dj:playbackUpdate', getDJState());
      callback?.({ success: true, state: getDJState() });
    });

    socket.on('dj:resume', (_data, callback) => {
      if (!isDJHostSocket(socket)) return callback?.({ error: 'Unauthorized' });
      djResume();
      broadcastToRoom(io, 'dj', 'dj:playbackUpdate', getDJState());
      callback?.({ success: true, state: getDJState() });
    });

    socket.on('dj:seek', (data, callback) => {
      if (!isDJHostSocket(socket)) return callback?.({ error: 'Unauthorized' });
      if (typeof data?.time !== 'number' || !Number.isFinite(data.time) || data.time < 0) {
        return callback?.({ error: 'Invalid time' });
      }
      djSeek(data.time);
      broadcastToRoom(io, 'dj', 'dj:playbackUpdate', getDJState());
      callback?.({ success: true, state: getDJState() });
    });

    socket.on('dj:ended', (_data, callback) => {
      if (!isDJHostSocket(socket)) return callback?.({ error: 'Unauthorized' });
      const state = djEnd();
      broadcastToRoom(io, 'dj', 'dj:playbackUpdate', state);
      callback?.({ success: true, state });
    });

    socket.on('dj:playlist', (_data, callback) => {
      callback?.({ success: true, playlist: getPlaylist() });
    });

    socket.on('dj:setOrder', (data, callback) => {
      if (!isDJHostSocket(socket)) return callback?.({ error: 'Unauthorized' });
      try {
        const order = setOrder('dj', data?.order);
        broadcastToRoom(io, 'dj', 'orderUpdate', { room: 'dj', order });
        callback?.({ success: true, order });
      } catch (err) {
        callback?.({ error: err.message });
      }
    });

    socket.on('host:authenticate', (data, callback) => {
      const room = data?.room === 'dj' ? 'dj' : 'movie';

      if (room === 'dj') {
        if (verifyHostTokenForRoom(data.token, 'dj')) {
          const state = getRoomState(room);
          if (state.hostSocketId && state.hostSocketId !== socket.id) {
            io.to(state.hostSocketId).emit('host:revoked');
          }
          socket.data.isHost = true;
          socket.data.hostRoom = 'dj';
          state.hostSocketId = socket.id;
          const user = state.users.get(socket.id);
          if (user) user.isHost = true;
          logger.info(`DJ host authenticated: ${socket.id}`);
          callback?.({ success: true });
          broadcastUsersList(io, room);
        } else {
          callback?.({ error: 'Invalid token' });
        }
      } else {
        if (verifyHostToken(data.token, 'movie')) {
          const state = getRoomState(room);
          if (state.hostSocketId && state.hostSocketId !== socket.id) {
            io.to(state.hostSocketId).emit('host:revoked');
          }
          socket.data.isHost = true;
          socket.data.hostRoom = 'movie';
          state.hostSocketId = socket.id;
          const user = state.users.get(socket.id);
          if (user) user.isHost = true;
          logger.info(`Host authenticated: ${socket.id}`);
          if (isStreamActive()) {
            logger.info(`Host reconnected — stream already active: ${getCurrentMovie()}`);
          }
          callback?.({ success: true });
          broadcastUsersList(io, room);
        } else {
          callback?.({ error: 'Invalid token' });
        }
      }
    });

    socket.on('disconnect', () => {
      const room = getRoom(socket);
      const state = getRoomState(room);
      const user = state.users.get(socket.id);
      if (user) {
        logger.info(`User disconnected: ${user.name} (${socket.id}) from ${room}`);
        const leaveMsg = {
          id: Date.now() + '-leave-' + socket.id,
          type: 'system',
          text: `${user.name} left the ${room === 'dj' ? 'DJ' : 'watch'} party`,
          timestamp: Date.now(),
        };
        state.chatHistory.push(leaveMsg);
        if (state.chatHistory.length > MAX_CHAT_HISTORY) state.chatHistory.shift();
        broadcastToRoom(io, room, 'chat:system', leaveMsg);
      }

      if (socket.id === state.hostSocketId) {
        state.hostSocketId = null;
        logger.info(`Host disconnected from ${room}`);
      }
      state.users.delete(socket.id);
      viewerHealth.delete(socket.id);
      throwCooldowns.delete(socket.id);
      broadcastUsersList(io, room);
    });

    socket.on('host:reactions:toggle', (data, callback) => {
      if (!isHostSocket(socket)) return callback?.({ error: 'Unauthorized' });
      const room = getRoom(socket);
      const state = getRoomState(room);
      state.reactionsEnabled = data?.enabled !== false;
      broadcastToRoom(io, room, 'reactions:enabled', state.reactionsEnabled);
      callback?.({ success: true, enabled: state.reactionsEnabled });
    });

    socket.on('host:refreshMovies', async (data, callback) => {
      if (!isHostSocket(socket) || getRoom(socket) !== 'movie') return callback?.({ error: 'Unauthorized' });
      const movies = await getMovieList();
      broadcastToRoom(io, 'movie', 'movies:updated', movies);
      callback?.({ success: true, count: movies.length });
    });

    socket.on('host:resync', (_data, callback) => {
      if (!isHostSocket(socket) || getRoom(socket) !== 'movie') return callback?.({ error: 'Unauthorized' });
      const state = getPlaybackState();
      broadcastToRoom(io, 'movie', 'playbackUpdate', { ...state, forceResync: true });
      callback?.({ success: true });
    });

    socket.on('dj:resync', (_data, callback) => {
      if (!isDJHostSocket(socket)) return callback?.({ error: 'Unauthorized' });
      const state = getDJState();
      broadcastToRoom(io, 'dj', 'dj:playbackUpdate', { ...state, forceResync: true });
      callback?.({ success: true });
    });
  });
}
