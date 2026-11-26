import { getPlaybackState, restorePlayback, pausePlayback } from './streamManager.js';
import { getPlaybackState as getDJState, restorePlayback as restoreDJ, pausePlayback as pauseDJ } from './djManager.js';
import { getWebState, restoreWeb, pauseWeb } from './webManager.js';
import { getSkipProfile } from './skipStore.js';
import { getRoomState, MAX_CHAT_HISTORY } from './rooms.js';
import { tomatoResolve } from './tomatoBridge.js';
import { buildStreamProxyUrl, streamHost } from './webProxy.js';
import { readStateFile, writeStateFile } from './stateStore.js';
import { getResumePolicy } from './resumePolicyStore.js';
import { logger } from './logger.js';

const INTERVAL_MS = 5000;
const DEBOUNCE_MS = 400;

let interval = null;
let timer = null;
let enabled = false;
let restoredAt = null;

export function buildSnapshot() {
  const movie = getPlaybackState();
  const dj = getDJState();
  const web = getWebState();

  return {
    version: 1,
    movie: movie.movie
      ? { movie: movie.movie, quality: movie.quality, isPlaying: movie.isPlaying, currentTime: movie.currentTime }
      : null,
    dj: dj.track
      ? { track: dj.track, isPlaying: dj.isPlaying, currentTime: dj.currentTime }
      : null,
    web: web.web
      ? {
        source: web.web.source,
        id: web.web.id,
        episodeKey: web.web.episodeKey,
        episodeNumber: web.web.episodeNumber,
        mode: web.web.mode,
        title: web.web.title,
        showKey: web.web.showKey,
        isPlaying: web.isPlaying,
        currentTime: web.currentTime,
        skip: web.web.skip || null,
      }
      : null,
    chat: {
      movie: getRoomState('movie').chatHistory.slice(-MAX_CHAT_HISTORY),
      dj: getRoomState('dj').chatHistory.slice(-MAX_CHAT_HISTORY),
    },
  };
}

export function persistNow() {
  if (!enabled) return;
  try {
    writeStateFile(buildSnapshot());
  } catch (err) {
    logger.error(`Failed to save persistent state: ${err.message}`);
  }
}

export function requestPersist() {
  if (!enabled) return;
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    persistNow();
  }, DEBOUNCE_MS);
}

async function reResolveWeb(saved) {
  const result = await tomatoResolve(saved.source, saved.id, saved.episodeKey, saved.mode);
  const streams = Array.isArray(result.streams) ? result.streams : [];
  const stream = streams.find((item) => item.type === 'hls') || streams[0];
  if (!stream || !stream.url) return null;

  const host = streamHost(stream.url);
  if (!host) return null;
  const referrer = stream.referrer || '';
  const origin = stream.origin || '';

  const subtitles = (Array.isArray(result.subtitles) ? result.subtitles : [])
    .map((sub) => {
      const subHost = streamHost(sub.url);
      if (!subHost) return null;
      return {
        lang: sub.lang || 'und',
        url: sub.url,
        proxyUrl: buildStreamProxyUrl(sub.url, { hosts: [subHost], referrer, origin }),
      };
    })
    .filter(Boolean);

  return {
    source: saved.source,
    id: saved.id,
    title: saved.title,
    episodeKey: saved.episodeKey,
    episodeNumber: saved.episodeNumber || String(saved.episodeKey),
    mode: saved.mode,
    quality: stream.quality || '',
    type: stream.type || 'hls',
    proxyUrl: buildStreamProxyUrl(stream.url, { hosts: [host], referrer, origin }),
    referrer,
    origin,
    subtitles,
    live: false,
    showKey: saved.showKey,
    showTitle: saved.title,
    skip: saved.skip || (saved.showKey ? getSkipProfile(saved.showKey) : null),
  };
}

export async function applySnapshot(snapshot) {
  if (!snapshot) return;

  for (const roomName of ['movie', 'dj']) {
    const history = Array.isArray(snapshot.chat?.[roomName]) ? snapshot.chat[roomName] : [];
    getRoomState(roomName).chatHistory = history.slice(-MAX_CHAT_HISTORY);
  }

  if (snapshot.movie?.movie) {
    try {
      await restorePlayback(snapshot.movie);
    } catch (err) {
      logger.warn(`Movie restore skipped: ${err.message}`);
    }
  }

  if (snapshot.dj?.track) {
    try {
      await restoreDJ(snapshot.dj);
    } catch (err) {
      logger.warn(`DJ restore skipped: ${err.message}`);
    }
  }

  if (snapshot.web?.source) {
    try {
      const descriptor = await reResolveWeb(snapshot.web);
      if (descriptor) {
        restoreWeb(descriptor, { isPlaying: snapshot.web.isPlaying, currentTime: snapshot.web.currentTime });
      }
    } catch (err) {
      logger.warn(`Web restore skipped: ${err.message}`);
    }
  }

  restoredAt = Date.now();
}

export function getRestoredAt() {
  return restoredAt;
}

export async function initPersistence() {
  enabled = true;
  await applySnapshot(readStateFile());

  const resumeOnStart = getResumePolicy().resumeOnStart;
  if (!resumeOnStart) {
    pausePlayback();
    pauseDJ();
    pauseWeb();
    persistNow();
  }

  if (interval) clearInterval(interval);
  interval = setInterval(persistNow, INTERVAL_MS);

  const shutdown = () => {
    persistNow();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  logger.info('Persistent state enabled');
}
