import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import { mkdirSync, existsSync, unlinkSync, copyFileSync, readFileSync, writeFileSync, rmSync, watch } from 'fs';
import { readdir, stat } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { logger } from './logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '..', '.env') });

const CONFIG_PATH = join(__dirname, '..', 'config.json');

const execAsync = promisify(exec);

const MOVIE_DIR = process.env.MOVIE_DIR || './movies';
const STREAM_DIR = process.env.STREAM_DIR || './streams';

const VIDEO_EXTENSIONS = ['.mp4', '.mkv', '.avi', '.mov', '.webm', '.flv', '.wmv', '.m4v'];

let ioRef = null;

export function setIoRef(io) {
  ioRef = io;
}
const QUALITIES = ['1080p', '720p', '480p'];
const DEFAULT_QUALITY = '1080p';

let encoderConfig = { encoder: 'libx264', preset: 'ultrafast', hardware: false, vaapiDevice: null };
let encoderDetected = false;

let currentMovie = null;
let currentQuality = DEFAULT_QUALITY;
let isPlaying = false;
let playbackStartTime = null;
let playbackOffset = 0;
let streamProcess = null;

let lastReportedPosition = 0;
let lastReportTime = 0;

let transcoding = false;
let transcodeProgress = 0;
let movieDuration = 0;

let config = loadConfig();

function loadConfig() {
  const defaults = { showForceQualityToast: true, showAutoRaiseToast: true };

  try {
    const raw = readFileSync(CONFIG_PATH, 'utf8');
    const parsed = JSON.parse(raw);

    if (typeof parsed !== 'object' || parsed === null) {
      logger.warn('⚠️ config.json invalid: expected object, using defaults');
      return defaults;
    }

    const validKeys = Object.keys(defaults);
    const unknownKeys = Object.keys(parsed).filter(k => !validKeys.includes(k));
    const missingKeys = validKeys.filter(k => !(k in parsed));

    if (unknownKeys.length > 0) {
      logger.warn(`⚠️ config.json unknown keys: ${unknownKeys.join(', ')} — ignoring`);
    }
    if (missingKeys.length > 0) {
      logger.warn(`⚠️ config.json missing keys: ${missingKeys.join(', ')} — using defaults`);
    }

    const result = { ...defaults };
    for (const key of validKeys) {
      if (key in parsed && typeof parsed[key] === typeof defaults[key]) {
        result[key] = parsed[key];
      } else if (key in parsed) {
        logger.warn(`⚠️ config.json key "${key}" has wrong type (expected ${typeof defaults[key]}), using default`);
      }
    }

    logger.info('Config loaded from config.json');
    return result;
  } catch (err) {
    if (err.code === 'ENOENT') {
      logger.warn('⚠️ config.json not found, using defaults');
    } else if (err instanceof SyntaxError) {
      logger.warn('⚠️ config.json invalid JSON, using defaults');
    } else {
      logger.warn(`⚠️ config.json read error: ${err.message}, using defaults`);
    }
    return defaults;
  }
}

let configDebounce = null;
watch(CONFIG_PATH, () => {
  clearTimeout(configDebounce);
  configDebounce = setTimeout(() => {
    config = loadConfig();
    logger.info('Config reloaded from config.json');
  }, 500);
});

function resolveConfig(key, envVar) {
  if (envVar && process.env[envVar] !== undefined) {
    return process.env[envVar] === 'true';
  }
  return config[key];
}

function shouldShowForceToast() {
  return resolveConfig('showForceQualityToast', 'TWP_SHOW_FORCE_QUALITY_TOAST');
}

function shouldShowAutoRaiseToast() {
  return resolveConfig('showAutoRaiseToast', 'TWP_SHOW_AUTO_RAISE_TOAST');
}

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

function getStreamPath2(movieName, quality) {
  return join(STREAM_DIR, movieName + '.' + (quality || DEFAULT_QUALITY) + '.mp4');
}

function getMetaPath2(movieName) {
  return join(STREAM_DIR, movieName + '.meta.json');
}

function getMeta2(movieName) {
  try {
    return JSON.parse(readFileSync(getMetaPath2(movieName), 'utf8'));
  } catch {
    return null;
  }
}

function saveMeta2(movieName, sourceStat, complete = false) {
  writeFileSync(getMetaPath2(movieName), JSON.stringify({
    sourceSize: sourceStat.size,
    sourceMtime: sourceStat.mtimeMs,
    complete,
  }));
}

function isCacheValid2(movieName, sourceStat) {
  const meta = getMeta2(movieName);
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
  } else {
    args.push('-b:v', '8M');
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

export function getCurrentQuality() {
  return currentQuality;
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

      const streamPath = getStreamPath2(file, DEFAULT_QUALITY);
      const isCached = existsSync(streamPath) && isCacheValid2(file, fileStat);

      movies.push({
        name: file,
        displayName: file.replace(ext, '').replace(/[._-]/g, ' '),
        size: fileStat.size,
        duration,
        cached: isCached,
        qualities: QUALITIES,
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
    quality: currentQuality,
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

export async function playMovie(movieName, quality) {
  const moviePath = join(MOVIE_DIR, movieName);
  if (!existsSync(moviePath)) {
    throw new Error('Movie not found');
  }

  if (!encoderDetected) {
    await detectEncoder();
    encoderDetected = true;
  }

  const sourceStat = await stat(moviePath);
  const effectiveQuality = quality || DEFAULT_QUALITY;
  const masterPath = getStreamPath2(movieName, DEFAULT_QUALITY);
  const streamPath = getStreamPath2(movieName, effectiveQuality);

  if (existsSync(masterPath) && isCacheValid2(movieName, sourceStat)) {
    logger.info(`Cache hit: ${movieName}`);
    stopTranscoding();
    currentMovie = movieName;
    currentQuality = effectiveQuality;
    resetPlaybackKeepCache();
    return getPlaybackState();
  }

  stopTranscoding();

  if (existsSync(masterPath)) {
    unlinkSync(masterPath);
    rmSync(getMetaPath2(movieName), { force: true });
  }

  if (existsSync(streamPath)) {
    unlinkSync(streamPath);
  }
  const outputPath = getStreamPath2(movieName, DEFAULT_QUALITY);

  if (await isBrowserCompatible(moviePath)) {
    logger.info(`Direct copy: ${movieName}`);
    copyFileSync(moviePath, outputPath);
    saveMeta2(movieName, sourceStat, true);
    currentMovie = movieName;
    currentQuality = effectiveQuality;
    resetPlaybackKeepCache();
    deriveQualitiesInBackground(movieName, outputPath);
    return getPlaybackState();
  }

  logger.info(`Transcoding: ${movieName} (${DEFAULT_QUALITY})`);

  saveMeta2(movieName, sourceStat, false);

  transcoding = true;
  transcodeProgress = 0;

  try {
    const totalDuration = await probeDuration(moviePath);
    const args = buildTranscodeArgs(moviePath, outputPath);
    streamProcess = spawn('ffmpeg', args);

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
        saveMeta2(movieName, sourceStat, true);
        deriveQualitiesInBackground(movieName, outputPath);
      }
      streamProcess = null;
      ioRef?.emit('playbackUpdate', getPlaybackState());
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
  currentQuality = effectiveQuality;
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
  currentQuality = DEFAULT_QUALITY;
  isPlaying = false;
  playbackStartTime = null;
  playbackOffset = 0;
  lastReportedPosition = 0;
  lastReportTime = 0;
  movieDuration = 0;
  return getPlaybackState();
}

export async function changeQuality(movieName, newQuality) {
  if (movieName !== currentMovie) {
    return playMovie(movieName, newQuality);
  }

  const moviePath = join(MOVIE_DIR, movieName);
  const streamPath = getStreamPath2(movieName, newQuality);

  if (existsSync(streamPath) && isCacheValid2(movieName, await stat(moviePath))) {
    logger.info(`Quality switch: ${movieName} → ${newQuality}`);
    currentQuality = newQuality;
    return getPlaybackState();
  }

  return getPlaybackState();
}

const QUALITY_DERIVES = [
  { quality: '720p', width: 1280, height: 720, bitrate: '5M' },
  { quality: '480p', width: 854, height: 480, bitrate: '2M' },
];

async function deriveQualitiesInBackground(movieName, masterPath) {
  for (const derive of QUALITY_DERIVES) {
    const outputPath = getStreamPath2(movieName, derive.quality);
    if (existsSync(outputPath)) continue;

    logger.info(`Deriving ${derive.quality} for ${movieName}`);
    try {
      await new Promise((resolve, reject) => {
        const proc = spawn('ffmpeg', [
          '-i', masterPath,
          '-vf', `scale=${derive.width}:${derive.height}`,
          '-c:v', 'libx264', '-preset', 'ultrafast',
          '-b:v', derive.bitrate,
          '-c:a', 'copy',
          '-y', outputPath,
        ]);
        proc.on('exit', code => code === 0 ? resolve() : reject(new Error(`derive ${derive.quality} failed`)));
        proc.on('error', reject);
      });
      logger.info(`Derived ${derive.quality} for ${movieName}`);
    } catch (err) {
      logger.error(`Derive error: ${err.message}`);
    }
  }
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
    if (!file.endsWith('.mp4') || file.endsWith('.meta.json')) continue;

    const movieName = file.replace('.mp4', '');
    if (movieName.includes('.')) continue;

    const masterPath = getStreamPath2(movieName, DEFAULT_QUALITY);
    if (existsSync(masterPath) && !existsSync(getMetaPath2(movieName))) {
      const streamStat = await stat(masterPath);
      if (streamStat.size > 100 * 1024 * 1024) {
        const sourcePath = join(MOVIE_DIR, movieName);
        if (existsSync(sourcePath)) {
          saveMeta2(movieName, await stat(sourcePath), true);
          logger.info(`Rebuilt cache: ${movieName}`);
          deriveQualitiesInBackground(movieName, masterPath);
        }
      }
    }
  }
}
