import { readdir, stat } from 'fs/promises';
import { mkdirSync, existsSync } from 'fs';
import { join, relative, sep, extname } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { createHash } from 'crypto';
import { getMusicDir, safeJoin, getStreamDirBase } from './streamManager.js';
import { logger } from './logger.js';

const execFileAsync = promisify(execFile);

const AUDIO_EXTENSIONS = ['.mp3', '.flac', '.wav', '.ogg', '.m4a', '.aac', '.wma', '.opus'];
const ART_DIR = join(getStreamDirBase(), '_audio_art');

let currentTrack = null;
let isPlaying = false;
let playbackStartTime = null;
let playbackOffset = 0;
let lastReportedPosition = 0;
let lastReportTime = 0;
let playlist = [];
let shuffle = false;
let repeat = 'all';
const metaCache = new Map();

export function isSafeRelativePath(name) {
  if (typeof name !== 'string' || name.length === 0) return false;
  if (name.includes('\0') || name.includes('\\')) return false;
  if (name.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(name)) return false;
  return name.split('/').every(part => part.length > 0 && part !== '.' && part !== '..');
}

function cleanTag(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

function tag(tags, key) {
  if (!tags) return null;
  const lower = key.toLowerCase();
  for (const [name, value] of Object.entries(tags)) {
    if (name.toLowerCase() === lower) return cleanTag(value);
  }
  return null;
}

async function walkAudio(dir, base, out) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkAudio(abs, base, out);
    } else if (entry.isFile()) {
      const ext = extname(entry.name).toLowerCase();
      if (!AUDIO_EXTENSIONS.includes(ext)) continue;
      out.push({ abs, name: relative(base, abs).split(sep).join('/') });
    }
  }
}

async function probeTrack(abs) {
  const fileStat = await stat(abs);
  const cached = metaCache.get(abs);
  if (cached && cached.mtimeMs === fileStat.mtimeMs && cached.size === fileStat.size) {
    return cached.meta;
  }

  let duration = null;
  let bitRate = null;
  let hasArt = false;
  let tags = {};

  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration,bit_rate:format_tags=title,artist,album,track,genre,date:stream=codec_type,codec_name',
      '-of', 'json',
      abs,
    ]);
    const data = JSON.parse(stdout || '{}');
    const format = data.format || {};
    const parsedDuration = parseFloat(format.duration);
    if (Number.isFinite(parsedDuration)) duration = Math.round(parsedDuration);
    const parsedBitRate = parseInt(format.bit_rate, 10);
    if (Number.isFinite(parsedBitRate)) bitRate = parsedBitRate;
    tags = format.tags || {};
    hasArt = (data.streams || []).some(stream => stream.codec_type === 'video');
  } catch {}

  const meta = {
    duration,
    bitRate,
    hasArt,
    title: tag(tags, 'title'),
    artist: tag(tags, 'artist'),
    album: tag(tags, 'album'),
    track: tag(tags, 'track'),
    genre: tag(tags, 'genre'),
    year: tag(tags, 'date') || tag(tags, 'year'),
  };

  metaCache.set(abs, { mtimeMs: fileStat.mtimeMs, size: fileStat.size, meta });
  return meta;
}

export async function getAudioFileList() {
  try {
    const musicDir = getMusicDir();
    mkdirSync(musicDir, { recursive: true });
    const found = [];
    await walkAudio(musicDir, musicDir, found);

    const tracks = [];
    for (const file of found) {
      const meta = await probeTrack(file.abs);
      const base = file.name.split('/').pop();
      const ext = extname(base);
      const fallback = base.replace(ext, '').replace(/[._-]+/g, ' ').replace(/\s+/g, ' ').trim();
      tracks.push({ name: file.name, displayName: fallback, ...meta });
    }

    playlist = tracks.sort((a, b) => (a.displayName || '').localeCompare(b.displayName || ''));
    return playlist;
  } catch {
    return [];
  }
}

export function getPlaylist() {
  return playlist;
}

export async function playTrack(trackName) {
  if (!isSafeRelativePath(trackName)) throw new Error('Invalid track name');
  const filePath = safeJoin(getMusicDir(), trackName);
  try {
    await stat(filePath);
  } catch {
    throw new Error('Track not found');
  }

  currentTrack = trackName;
  isPlaying = false;
  playbackOffset = 0;
  lastReportedPosition = 0;
  lastReportTime = 0;
  playbackStartTime = null;
  return getPlaybackState();
}

export function pausePlayback() {
  if (!isPlaying) return getPlaybackState();
  playbackOffset += (Date.now() - playbackStartTime) / 1000;
  lastReportedPosition = playbackOffset;
  lastReportTime = 0;
  isPlaying = false;
  playbackStartTime = null;
  return getPlaybackState();
}

export function resumePlayback() {
  if (isPlaying || !currentTrack) return getPlaybackState();
  isPlaying = true;
  playbackStartTime = Date.now();
  lastReportTime = Date.now();
  return getPlaybackState();
}

export function seekPlayback(time) {
  playbackOffset = time;
  lastReportedPosition = time;
  lastReportTime = Date.now();
  if (isPlaying) {
    playbackStartTime = Date.now();
  }
  return getPlaybackState();
}

export function setShuffle(value) {
  shuffle = Boolean(value);
  return getPlaybackState();
}

export function setRepeat(value) {
  repeat = value === 'all' || value === 'one' ? value : 'off';
  return getPlaybackState();
}

export function updateDJPosition(position) {
  if (!isPlaying) {
    lastReportedPosition = position;
    lastReportTime = Date.now();
    return;
  }
  const serverTime = playbackOffset + (Date.now() - playbackStartTime) / 1000;
  const drift = position - serverTime;
  if (Math.abs(drift) > 1) {
    playbackStartTime = Date.now();
    playbackOffset = position;
  }
  lastReportedPosition = position;
  lastReportTime = Date.now();
}

export function getPlaybackState() {
  let currentTime = 0;

  if (isPlaying) {
    if (lastReportTime > 0) {
      const elapsed = (Date.now() - lastReportTime) / 1000;
      currentTime = lastReportedPosition + elapsed;
    } else if (playbackStartTime) {
      currentTime = playbackOffset + (Date.now() - playbackStartTime) / 1000;
    }
  } else {
    currentTime = playbackOffset > 0 ? playbackOffset : lastReportedPosition;
  }

  return {
    track: currentTrack,
    isPlaying,
    currentTime: Math.max(0, currentTime),
    shuffle,
    repeat,
  };
}

export function isDJActive() {
  return currentTrack !== null;
}

export function endPlayback() {
  currentTrack = null;
  isPlaying = false;
  playbackStartTime = null;
  playbackOffset = 0;
  lastReportedPosition = 0;
  lastReportTime = 0;
  return getPlaybackState();
}

export async function ensureTrackCover(trackName) {
  if (!isSafeRelativePath(trackName)) throw new Error('Invalid track name');
  const abs = safeJoin(getMusicDir(), trackName);
  const fileStat = await stat(abs);
  const meta = await probeTrack(abs);
  if (!meta.hasArt) return null;

  mkdirSync(ART_DIR, { recursive: true });
  const key = createHash('sha1').update(`${abs}:${fileStat.mtimeMs}:${fileStat.size}`).digest('hex');
  const out = join(ART_DIR, `${key}.jpg`);
  if (!existsSync(out)) {
    await execFileAsync('ffmpeg', [
      '-v', 'error',
      '-i', abs,
      '-map', '0:v:0',
      '-an',
      '-c:v', 'mjpeg',
      '-q:v', '3',
      '-f', 'image2',
      out,
      '-y',
    ]);
  }
  return out;
}
