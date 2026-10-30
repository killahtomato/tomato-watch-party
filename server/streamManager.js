import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import { mkdirSync, existsSync, unlinkSync, copyFileSync, readFileSync, writeFileSync, rmSync } from 'fs';
import { readdir, stat } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { logger } from './logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '..', '.env') });

const execAsync = promisify(exec);

const MOVIE_DIR = process.env.MOVIE_DIR || './movies';
const STREAM_DIR = process.env.STREAM_DIR || './streams';

const VIDEO_EXTENSIONS = ['.mp4', '.mkv', '.avi', '.mov', '.webm', '.flv', '.wmv', '.m4v'];

let encoderConfig = { encoder: 'libx264', preset: 'ultrafast', hardware: false, vaapiDevice: null };
let encoderDetected = false;

let currentMovie = null;
let isPlaying = false;
let playbackStartTime = null;
let playbackOffset = 0;
let streamProcess = null;

let lastReportedPosition = 0;
let lastReportTime = 0;

let transcoding = false;
let transcodeProgress = 0;
let movieDuration = 0;

async function testEncoder(encoder) {
  try {
    await execAsync(
      `ffmpeg -hide_banner -f lavfi -i testsrc=duration=1:size=320x240:rate=10 -c:v ${encoder} -f null - 2>&1`,
      { timeout: 10000 }
    );
    return true;
  } catch {
    return false;
  }
}

async function detectEncoder() {
  if (process.env.TRANSCODE_ENCODER) {
    const enc = process.env.TRANSCODE_ENCODER;
    encoderConfig = {
      encoder: enc,
      preset: enc === 'libx264' ? 'ultrafast' : null,
      hardware: enc !== 'libx264',
      vaapiDevice: enc === 'h264_vaapi' ? '/dev/dri/renderD128' : null,
    };
    logger.info(`Transcode encoder: ${enc} (from env)`);
    return;
  }

  try {
    const { stdout } = await execAsync('ffmpeg -hide_banner -encoders 2>/dev/null');
    const available = stdout;

    const candidates = [
      { encoder: 'h264_nvenc', preset: 'p4', hardware: true, vaapiDevice: null },
      { encoder: 'h264_qsv', preset: 'veryfast', hardware: true, vaapiDevice: null },
      { encoder: 'h264_vaapi', preset: null, hardware: true, vaapiDevice: '/dev/dri/renderD128' },
    ];

    for (const candidate of candidates) {
      if (available.includes(candidate.encoder)) {
        const works = await testEncoder(candidate.encoder);
        if (works) {
          encoderConfig = candidate;
          break;
        } else {
          logger.info(`Encoder ${candidate.encoder} available but not functional, skipping`);
        }
      }
    }
  } catch (err) {
    logger.warn(`Encoder detection failed, using libx264 fallback: ${err.message}`);
  }

  logger.info(`Transcode encoder: ${encoderConfig.encoder} (hardware: ${encoderConfig.hardware})`);
}

async function isBrowserCompatible(moviePath) {
  const ext = moviePath.slice(moviePath.lastIndexOf('.')).toLowerCase();
  if (ext !== '.mp4' && ext !== '.m4v') return false;
  try {
    const { stdout: v } = await execAsync(
      `ffprobe -v error -select_streams v:0 -show_entries stream=codec_name -of csv=p=0 "${moviePath}"`
    );
    const { stdout: a } = await execAsync(
      `ffprobe -v error -select_streams a:0 -show_entries stream=codec_name -of csv=p=0 "${moviePath}"`
    );
    return v.trim() === 'h264' && a.trim() === 'aac';
  } catch {
    return false;
  }
}

async function probeDuration(moviePath) {
  try {
    const { stdout } = await execAsync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${moviePath}"`
    );
    return parseFloat(stdout.trim());
  } catch {
    return 0;
  }
}

function getMetaPath(streamPath) {
  return streamPath + '.meta.json';
}

function getMeta(streamPath) {
  try {
    return JSON.parse(readFileSync(getMetaPath(streamPath), 'utf8'));
  } catch {
    return null;
  }
}

function saveMeta(streamPath, sourceStat, complete = false) {
  writeFileSync(getMetaPath(streamPath), JSON.stringify({
    sourceSize: sourceStat.size,
    sourceMtime: sourceStat.mtimeMs,
    complete,
  }));
}

function isCacheValid(streamPath, sourceStat) {
  const meta = getMeta(streamPath);
  if (!meta || !meta.complete) return false;
  return meta.sourceSize === sourceStat.size && meta.sourceMtime === sourceStat.mtimeMs;
}

function buildTranscodeArgs(moviePath, streamPath) {
  const args = ['-i', moviePath];

  if (encoderConfig.hardware && encoderConfig.vaapiDevice) {
    args.unshift('-vaapi_device', encoderConfig.vaapiDevice);
  }

  args.push('-c:v', encoderConfig.encoder);

  if (encoderConfig.preset) {
    args.push('-preset', encoderConfig.preset);
  }

  if (!encoderConfig.hardware) {
    args.push('-tune', 'film');
  }

  if (encoderConfig.encoder === 'h264_vaapi') {
    args.push('-qp', '24');
  }

  args.push('-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', '-y', streamPath);

  return args;
}

function resetPlaybackState() {
  isPlaying = false;
  playbackStartTime = null;
  playbackOffset = 0;
  lastReportedPosition = 0;
  lastReportTime = 0;
  transcoding = false;
  transcodeProgress = 100;
}

function resetPlaybackKeepCache() {
  isPlaying = false;
  playbackStartTime = null;
  playbackOffset = 0;
  lastReportedPosition = 0;
  lastReportTime = 0;
}

export function updateHostPosition(position) {
  lastReportedPosition = position;
  lastReportTime = Date.now();
}

export function getMovieDir() {
  return MOVIE_DIR;
}

export function getStreamDir() {
  return STREAM_DIR;
}

export async function getMovieList() {
  try {
    const files = await readdir(MOVIE_DIR);
    const movies = [];

    for (const file of files) {
      const ext = file.lastIndexOf('.') > 0 ? file.slice(file.lastIndexOf('.')).toLowerCase() : '';
      if (!VIDEO_EXTENSIONS.includes(ext)) continue;

      const filePath = join(MOVIE_DIR, file);
      const fileStat = await stat(filePath);

      let duration = null;
      try {
        const { stdout } = await execAsync(
          `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`
        );
        duration = Math.round(parseFloat(stdout.trim()));
      } catch {}

      const streamFile = join(STREAM_DIR, file + '.mp4');
      const isCached = existsSync(streamFile) && isCacheValid(streamFile, fileStat);

      movies.push({
        name: file,
        displayName: file.replace(ext, '').replace(/[._-]/g, ' '),
        size: fileStat.size,
        duration,
        cached: isCached,
      });
    }

    return movies.sort((a, b) => a.displayName.localeCompare(b.displayName));
  } catch {
    return [];
  }
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
    movie: currentMovie,
    isPlaying,
    currentTime: Math.max(0, currentTime),
    transcoding,
    transcodeProgress,
  };
}

export function isStreamActive() {
  return currentMovie !== null;
}

export function getCurrentMovie() {
  return currentMovie;
}

function getStreamPath(movieName) {
  if (!existsSync(STREAM_DIR)) {
    mkdirSync(STREAM_DIR, { recursive: true });
  }
  return join(STREAM_DIR, movieName + '.mp4');
}

export async function playMovie(movieName) {
  const moviePath = join(MOVIE_DIR, movieName);
  if (!existsSync(moviePath)) {
    throw new Error('Movie not found');
  }

  if (!encoderDetected) {
    await detectEncoder();
    encoderDetected = true;
  }

  const sourceStat = await stat(moviePath);
  const streamPath = getStreamPath(movieName);

  if (existsSync(streamPath) && isCacheValid(streamPath, sourceStat)) {
    logger.info(`Cache hit: ${movieName}`);
    stopTranscoding();
    currentMovie = movieName;
    resetPlaybackKeepCache();
    return getPlaybackState();
  }

  stopTranscoding();

  if (existsSync(streamPath)) {
    logger.info(`Cache stale, deleting: ${streamPath}`);
    unlinkSync(streamPath);
    rmSync(getMetaPath(streamPath), { force: true });
  }

  if (await isBrowserCompatible(moviePath)) {
    logger.info(`Direct copy (browser-compatible): ${movieName}`);
    copyFileSync(moviePath, streamPath);
    saveMeta(streamPath, sourceStat, true);
    currentMovie = movieName;
    resetPlaybackKeepCache();
    return getPlaybackState();
  }

  saveMeta(streamPath, sourceStat, false);

  logger.info(`Transcoding: ${movieName} with ${encoderConfig.encoder}`);

  transcoding = true;
  transcodeProgress = 0;

  try {
    const totalDuration = await probeDuration(moviePath);

    streamProcess = spawn('ffmpeg', buildTranscodeArgs(moviePath, streamPath));

    streamProcess.stderr?.on('data', (data) => {
      const output = data.toString();
      const timeMatch = output.match(/time=(\d+):(\d+):(\d+)\.(\d+)/);
      if (timeMatch && totalDuration > 0) {
        const h = parseInt(timeMatch[1]);
        const m = parseInt(timeMatch[2]);
        const s = parseInt(timeMatch[3]);
        const ms = parseInt(timeMatch[4]);
        const currentSec = h * 3600 + m * 60 + s + ms / 100;
        transcodeProgress = Math.min(100, Math.round((currentSec / totalDuration) * 100));
      }
    });

    streamProcess.on('exit', (code) => {
      transcoding = false;
      if (code === 0) {
        transcodeProgress = 100;
        if (streamPath === getStreamPath(currentMovie)) {
          saveMeta(streamPath, sourceStat, true);
        }
      }
      streamProcess = null;
    });

    streamProcess.on('error', (err) => {
      logger.error(`Transcode error: ${err.message}`);
      transcoding = false;
      transcodeProgress = 0;
      streamProcess = null;
    });

  } catch (err) {
    transcoding = false;
    transcodeProgress = 0;
    throw new Error('Failed to start transcoding: ' + err.message);
  }

  currentMovie = movieName;
  resetPlaybackKeepCache();

  return getPlaybackState();
}

export async function pausePlayback() {
  if (!isPlaying) return getPlaybackState();
  playbackOffset += (Date.now() - playbackStartTime) / 1000;
  lastReportedPosition = playbackOffset;
  lastReportTime = 0;
  isPlaying = false;
  playbackStartTime = null;
  return getPlaybackState();
}

export async function resumePlayback() {
  if (isPlaying || !currentMovie) return getPlaybackState();
  isPlaying = true;
  playbackStartTime = Date.now();
  lastReportTime = Date.now();
  return getPlaybackState();
}

export async function seekPlayback(time) {
  playbackOffset = time;
  lastReportedPosition = time;
  lastReportTime = Date.now();
  if (isPlaying) {
    playbackStartTime = Date.now();
  }
  return getPlaybackState();
}

export function endPlayback() {
  currentMovie = null;
  isPlaying = false;
  playbackStartTime = null;
  playbackOffset = 0;
  lastReportedPosition = 0;
  lastReportTime = 0;
  movieDuration = 0;
  return getPlaybackState();
}

function stopTranscoding() {
  if (streamProcess) {
    streamProcess.kill('SIGTERM');
    streamProcess = null;
  }
  transcoding = false;
  transcodeProgress = 0;
}

export async function initCache() {
  if (!existsSync(STREAM_DIR)) return;
  const files = await readdir(STREAM_DIR);
  for (const file of files) {
    if (!file.endsWith('.mp4')) continue;
    const streamPath = join(STREAM_DIR, file);
    if (existsSync(getMetaPath(streamPath))) continue;

    const streamStat = await stat(streamPath);
    if (streamStat.size > 100 * 1024 * 1024) {
      const sourceName = file.replace('.mp4', '');
      const sourcePath = join(MOVIE_DIR, sourceName);
      if (existsSync(sourcePath)) {
        saveMeta(streamPath, await stat(sourcePath), true);
        logger.info(`Rebuilt cache: ${sourceName}`);
      }
    } else {
      unlinkSync(streamPath);
      logger.info(`Deleted incomplete: ${file}`);
    }
  }
}
