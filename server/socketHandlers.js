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
import { setMovieBroadcast } from './streamManager.js';
import { setOrder } from './orderStore.js';
import {
  getWebState,
  playWeb,
  pauseWeb,
  resumeWeb,
  seekWeb,
  updateWebHostPosition,
  isWebActive,
  endWeb,
} from './webManager.js';
import { buildStreamProxyUrl } from './webProxy.js';
import {
  tomatoSearch,
  tomatoEpisodes,
  tomatoResolve,
  tomatoAudioModes,
  tomatoTrending,
  tomatoProbe,
} from './tomatoBridge.js';

const MAX_CHAT_HISTORY = 200;

const rooms = {
  movie: { users: new Map(), chatHistory: [], hostSocketId: null, reactionsEnabled: true },
  dj: { users: new Map(), chatHistory: [], hostSocketId: null, reactionsEnabled: true },
};

const throwCooldowns = new Map();
const viewerHealth = new Map();

let lastSeekBroadcast = 0;

function streamHost(url) {
  try {
    const parsed = new URL(String(url));
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.hostname;
  } catch {
    return null;
  }
}

function getRoom(socket) {
  return socket.data?.room || 'movie';
}

function getRoomState(room) {
  return rooms[room] || rooms.movie;
}

function isHostSocket(socket, room = getRoom(socket)) {
  if (socket.data?.isHost !== true) return false;
  const hostRooms = socket.data.hostRooms || (socket.data.hostRoom ? new Set([socket.data.hostRoom]) : null);
  if (!hostRooms || !hostRooms.has(room)) return false;
  return socket.id === getRoomState(room).hostSocketId;
}

function isDJHostSocket(socket) {
  return isHostSocket(socket, 'dj');
}

function broadcastToRoom(io, room, event, data, includeHost = false) {
  const state = getRoomState(room);
  for (const userId of state.users.keys()) {
    io.to(userId).emit(event, data);
  }
  if (includeHost && state.hostSocketId && !state.users.has(state.hostSocketId)) {
    io.to(state.hostSocketId).emit(event, data);
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
  setMovieBroadcast(state => broadcastToRoom(io, 'movie', 'playbackUpdate', state, true));

  setInterval(() => {
    if (isStreamActive()) {
      broadcastToRoom(io, 'movie', 'playbackUpdate', getPlaybackState(), true);
    }
  }, 3000);

  setInterval(() => {
    if (isDJActive()) {
      broadcastToRoom(io, 'dj', 'dj:playbackUpdate', getDJState(), true);
    }
  }, 3000);

  setInterval(() => {
    if (isWebActive()) {
      broadcastToRoom(io, 'movie', 'web:playbackUpdate', getWebState(), true);
    }
  }, 2000);

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
      const hostRooms = socket.data?.hostRooms;
      const isHostForRoom = Boolean(socket.data?.isHost && hostRooms && hostRooms.has(room));
      state.users.set(socket.id, {
        id: socket.id,
        name: finalName,
        joinedAt: Date.now(),
        side,
        isHost: isHostForRoom,
        room,
      });
      if (isHostForRoom && !state.hostSocketId) {
        state.hostSocketId = socket.id;
      }

      socket.data.room = room;

      const playbackState = room === 'dj' ? getDJState() : getPlaybackState();
      socket.emit('joined', {
        userId: socket.id,
        room,
        playbackState,
        webState: room === 'movie' ? getWebState() : undefined,
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
      if (!isHostSocket(socket, 'movie')) return;
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
      if (!isHostSocket(socket, 'movie')) {
        return callback?.({ error: 'Unauthorized' });
      }
      if (typeof data?.movie !== 'string' || data.movie.length === 0) {
        return callback?.({ error: 'Invalid movie' });
      }
      try {
        endWeb();
        const state = await playMovie(data.movie, data.quality);
        logger.info(`Host playing: ${data.movie}`);
        broadcastToRoom(io, 'movie', 'playbackUpdate', state, true);
        broadcastToRoom(io, 'movie', 'web:playbackUpdate', { ...getWebState(), stopped: true }, true);
        callback?.({ success: true, state });
      } catch (err) {
        callback?.({ error: err.message });
      }
    });

    socket.on('web:search', async (data, callback) => {
      if (!isHostSocket(socket, 'movie')) return callback?.({ error: 'Unauthorized' });
      try {
        const result = await tomatoSearch(String(data?.q ?? ''), String(data?.source ?? 'all'));
        callback?.({ success: true, results: Array.isArray(result.results) ? result.results : [] });
      } catch (err) {
        callback?.({ error: err.message });
      }
    });

    socket.on('web:episodes', async (data, callback) => {
      if (!isHostSocket(socket, 'movie')) return callback?.({ error: 'Unauthorized' });
      try {
        const result = await tomatoEpisodes(String(data?.source ?? ''), String(data?.id ?? ''));
        callback?.({ success: true, episodes: Array.isArray(result.episodes) ? result.episodes : [] });
      } catch (err) {
        callback?.({ error: err.message });
      }
    });

    socket.on('web:audio-modes', async (data, callback) => {
      if (!isHostSocket(socket, 'movie')) return callback?.({ error: 'Unauthorized' });
      try {
        const result = await tomatoAudioModes(String(data?.source ?? ''), String(data?.id ?? ''), String(data?.ep ?? ''));
        callback?.({ success: true, modes: Array.isArray(result.modes) ? result.modes : [] });
      } catch (err) {
        callback?.({ error: err.message });
      }
    });

    socket.on('web:trending', async (_data, callback) => {
      if (!isHostSocket(socket, 'movie')) return callback?.({ error: 'Unauthorized' });
      try {
        const result = await tomatoTrending();
        callback?.({ success: true, results: Array.isArray(result.results) ? result.results : [] });
      } catch (err) {
        callback?.({ error: err.message });
      }
    });

    socket.on('web:probe', async (data, callback) => {
      if (!isHostSocket(socket, 'movie')) return callback?.({ error: 'Unauthorized' });
      try {
        const results = Array.isArray(data?.results) ? data.results : [];
        const playable = await tomatoProbe(results);
        const keys = playable
          .filter((entry) => entry && entry.source && entry.id)
          .map((entry) => `${entry.source}:${entry.id}`);
        callback?.({ success: true, playable: keys });
      } catch (err) {
        callback?.({ error: err.message });
      }
    });

    socket.on('web:resolve', async (data, callback) => {
      if (!isHostSocket(socket, 'movie')) return callback?.({ error: 'Unauthorized' });
      try {
        const result = await tomatoResolve(
          String(data?.source ?? ''),
          String(data?.id ?? ''),
          String(data?.ep ?? ''),
          String(data?.mode ?? 'sub')
        );
        const streams = (Array.isArray(result.streams) ? result.streams : [])
          .map((stream) => {
            const host = streamHost(stream.url);
            if (!host) return null;
            return {
              ...stream,
              proxyUrl: buildStreamProxyUrl(stream.url, {
                hosts: [host],
                referrer: stream.referrer,
                origin: stream.origin,
              }),
            };
          })
          .filter(Boolean);
        const subtitleReferrer = streams[0]?.referrer || '';
        const subtitleOrigin = streams[0]?.origin || '';
        const subtitles = (Array.isArray(result.subtitles) ? result.subtitles : [])
          .map((sub) => {
            const host = streamHost(sub.url);
            if (!host) return null;
            return {
              ...sub,
              proxyUrl: buildStreamProxyUrl(sub.url, {
                hosts: [host],
                referrer: subtitleReferrer,
                origin: subtitleOrigin,
              }),
            };
          })
          .filter(Boolean);
        callback?.({ success: true, streams, subtitles });
      } catch (err) {
        callback?.({ error: err.message });
      }
    });

    socket.on('web:play', (data, callback) => {
      if (!isHostSocket(socket, 'movie')) return callback?.({ error: 'Unauthorized' });
      try {
        endPlayback();
        const state = playWeb(data);
        logger.info(`Host playing web stream: ${state.web?.title ?? ''}`);
        broadcastToRoom(io, 'movie', 'web:playbackUpdate', state, true);
        callback?.({ success: true, state });
      } catch (err) {
        callback?.({ error: err.message });
      }
    });

    socket.on('web:pause', (_data, callback) => {
      if (!isHostSocket(socket, 'movie')) return callback?.({ error: 'Unauthorized' });
      const state = pauseWeb();
      broadcastToRoom(io, 'movie', 'web:playbackUpdate', state, true);
      callback?.({ success: true, state });
    });

    socket.on('web:resume', (_data, callback) => {
      if (!isHostSocket(socket, 'movie')) return callback?.({ error: 'Unauthorized' });
      const state = resumeWeb();
      broadcastToRoom(io, 'movie', 'web:playbackUpdate', state, true);
      callback?.({ success: true, state });
    });

    socket.on('web:seek', (data, callback) => {
      if (!isHostSocket(socket, 'movie')) return callback?.({ error: 'Unauthorized' });
      if (typeof data?.time !== 'number' || !Number.isFinite(data.time) || data.time < 0) {
        return callback?.({ error: 'Invalid time' });
      }
      const state = seekWeb(data.time);
      broadcastToRoom(io, 'movie', 'web:playbackUpdate', state, true);
      callback?.({ success: true, state });
    });

    socket.on('web:ended', (_data, callback) => {
      if (!isHostSocket(socket, 'movie')) return callback?.({ error: 'Unauthorized' });
      const state = endWeb();
      broadcastToRoom(io, 'movie', 'web:playbackUpdate', state, true);
      callback?.({ success: true, state });
    });

    socket.on('web:resync', (_data, callback) => {
      if (!isHostSocket(socket, 'movie')) return callback?.({ error: 'Unauthorized' });
      broadcastToRoom(io, 'movie', 'web:playbackUpdate', { ...getWebState(), forceResync: true }, true);
      callback?.({ success: true });
    });

    socket.on('web:sync', (data) => {
      if (!isHostSocket(socket, 'movie')) return;
      if (typeof data?.position === 'number') {
        updateWebHostPosition(data.position);
      }
    });

    socket.on('host:pause', (_data, callback) => {
      if (!isHostSocket(socket, 'movie')) return callback?.({ error: 'Unauthorized' });
      pausePlayback();
      broadcastToRoom(io, 'movie', 'playbackUpdate', getPlaybackState(), true);
      callback?.({ success: true, state: getPlaybackState() });
    });

    socket.on('host:resume', (_data, callback) => {
      if (!isHostSocket(socket, 'movie')) return callback?.({ error: 'Unauthorized' });
      resumePlayback();
      broadcastToRoom(io, 'movie', 'playbackUpdate', getPlaybackState(), true);
      callback?.({ success: true, state: getPlaybackState() });
    });

    socket.on('host:seek', (data, callback) => {
      if (!isHostSocket(socket, 'movie')) return callback?.({ error: 'Unauthorized' });
      if (typeof data?.time !== 'number' || !Number.isFinite(data.time) || data.time < 0) {
        return callback?.({ error: 'Invalid time' });
      }
      seekPlayback(data.time);
      const now = Date.now();
      if (now - lastSeekBroadcast > 500) {
        lastSeekBroadcast = now;
        broadcastToRoom(io, 'movie', 'playbackUpdate', getPlaybackState(), true);
      }
      callback?.({ success: true, state: getPlaybackState() });
    });

    socket.on('host:ended', (_data, callback) => {
      if (!isHostSocket(socket, 'movie')) return callback?.({ error: 'Unauthorized' });
      if (!isStreamActive()) return callback?.({ success: true });
      const state = endPlayback();
      broadcastToRoom(io, 'movie', 'playbackUpdate', state, true);
      callback?.({ success: true, state });
    });

    socket.on('movie:setOrder', (data, callback) => {
      if (!isHostSocket(socket, 'movie')) return callback?.({ error: 'Unauthorized' });
      try {
        const order = setOrder('movie', data?.order);
        broadcastToRoom(io, 'movie', 'orderUpdate', { room: 'movie', order }, true);
        callback?.({ success: true, order });
      } catch (err) {
        callback?.({ error: err.message });
      }
    });

    socket.on('host:forceQuality', (data, callback) => {
      if (!isHostSocket(socket, 'movie')) return callback?.({ error: 'Unauthorized' });
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
      if (!isHostSocket(socket, 'movie')) return;
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
        broadcastToRoom(io, 'dj', 'dj:playbackUpdate', state, true);
        broadcastToRoom(io, 'dj', 'dj:trackChange', { track: data.track });
        callback?.({ success: true, state });
      } catch (err) {
        callback?.({ error: err.message });
      }
    });

    socket.on('dj:pause', (_data, callback) => {
      if (!isDJHostSocket(socket)) return callback?.({ error: 'Unauthorized' });
      djPause();
      broadcastToRoom(io, 'dj', 'dj:playbackUpdate', getDJState(), true);
      callback?.({ success: true, state: getDJState() });
    });

    socket.on('dj:resume', (_data, callback) => {
      if (!isDJHostSocket(socket)) return callback?.({ error: 'Unauthorized' });
      djResume();
      broadcastToRoom(io, 'dj', 'dj:playbackUpdate', getDJState(), true);
      callback?.({ success: true, state: getDJState() });
    });

    socket.on('dj:seek', (data, callback) => {
      if (!isDJHostSocket(socket)) return callback?.({ error: 'Unauthorized' });
      if (typeof data?.time !== 'number' || !Number.isFinite(data.time) || data.time < 0) {
        return callback?.({ error: 'Invalid time' });
      }
      djSeek(data.time);
      broadcastToRoom(io, 'dj', 'dj:playbackUpdate', getDJState(), true);
      callback?.({ success: true, state: getDJState() });
    });

    socket.on('dj:ended', (_data, callback) => {
      if (!isDJHostSocket(socket)) return callback?.({ error: 'Unauthorized' });
      const state = djEnd();
      broadcastToRoom(io, 'dj', 'dj:playbackUpdate', state, true);
      callback?.({ success: true, state });
    });

    socket.on('dj:playlist', (_data, callback) => {
      callback?.({ success: true, playlist: getPlaylist() });
    });

    socket.on('dj:setOrder', (data, callback) => {
      if (!isDJHostSocket(socket)) return callback?.({ error: 'Unauthorized' });
      try {
        const order = setOrder('dj', data?.order);
        broadcastToRoom(io, 'dj', 'orderUpdate', { room: 'dj', order }, true);
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
          if (!socket.data.hostRooms) socket.data.hostRooms = new Set();
          socket.data.hostRooms.add(room);
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
          if (!socket.data.hostRooms) socket.data.hostRooms = new Set();
          socket.data.hostRooms.add(room);
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
      if (!isHostSocket(socket, getRoom(socket))) return callback?.({ error: 'Unauthorized' });
      const room = getRoom(socket);
      const state = getRoomState(room);
      state.reactionsEnabled = data?.enabled !== false;
      broadcastToRoom(io, room, 'reactions:enabled', state.reactionsEnabled);
      callback?.({ success: true, enabled: state.reactionsEnabled });
    });

    socket.on('host:refreshMovies', async (data, callback) => {
      if (!isHostSocket(socket, 'movie')) return callback?.({ error: 'Unauthorized' });
      const movies = await getMovieList();
      broadcastToRoom(io, 'movie', 'movies:updated', movies, true);
      callback?.({ success: true, count: movies.length });
    });

    socket.on('host:resync', (_data, callback) => {
      if (!isHostSocket(socket, 'movie')) return callback?.({ error: 'Unauthorized' });
      const state = getPlaybackState();
      broadcastToRoom(io, 'movie', 'playbackUpdate', { ...state, forceResync: true }, true);
      callback?.({ success: true });
    });

    socket.on('dj:resync', (_data, callback) => {
      if (!isDJHostSocket(socket)) return callback?.({ error: 'Unauthorized' });
      const state = getDJState();
      broadcastToRoom(io, 'dj', 'dj:playbackUpdate', { ...state, forceResync: true }, true);
      callback?.({ success: true });
    });
  });
}
