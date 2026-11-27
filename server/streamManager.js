import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import { mkdirSync, existsSync, copyFileSync, readFileSync, writeFileSync, statfsSync, renameSync, unlinkSync } from 'fs';
import { readdir, stat } from 'fs/promises';
import { join, dirname, resolve, sep } from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { logger } from './logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '..', '.env') });

const execFileAsync = promisify(execFile);

const MOVIE_DIR = process.env.MOVIE_DIR || './movies';
const MUSIC_DIR = process.env.MUSIC_DIR || './music';
const STREAM_DIR = process.env.STREAM_DIR || './streams';
const DATA_DIR = process.env.DATA_DIR || './data';
const HQ_ONLY = !['0', 'false', 'no', 'off'].includes(String(process.env.HQ_ONLY || '').toLowerCase());

export { STREAM_DIR, DATA_DIR };

const VIDEO_EXTENSIONS = ['.mp4', '.mkv', '.avi', '.mov', '.webm', '.flv', '.wmv', '.m4v'];
const DEFAULT_QUALITY = '1080p';

let encoderConfig = { encoder: 'libx264', preset: 'ultrafast', hardware: false, vaapiDevice: null };
let encoderDetected = false;

let currentMovie = null;
let currentQuality = DEFAULT_QUALITY;
let isPlaying = false;
let playbackStartTime = null;
let playbackOffset = 0;
let streamProcess = null;
let transcodeTmpPath = null;

let lastReportedPosition = 0;
let lastReportTime = 0;

let transcoding = false;
let transcodeProgress = 0;

const QUALITY_PRESETS = [
  { quality: '1080p', width: 1920, height: 1080, bitrate: '6M' },
  { quality: '720p', width: 1280, height: 720, bitrate: '5M' },
  { quality: '480p', width: 854, height: 480, bitrate: '2M' },
];

const QUALITY_SET = new Set(QUALITY_PRESETS.map(q => q.quality));

export function isValidQuality(quality) {
  return typeof quality === 'string' && QUALITY_SET.has(quality);
}

export function isSafeName(name) {
  return (
    typeof name === 'string' &&
    name.length > 0 &&
    name !== '.' &&
    name !== '..' &&
    !name.includes('/') &&
    !name.includes('\\') &&
    !name.includes('\0')
  );
}

export function safeJoin(base, ...parts) {
  const resolved = resolve(base, ...parts);
  const baseResolved = resolve(base);
  if (resolved !== baseResolved && !resolved.startsWith(baseResolved + sep)) {
    throw new Error('Path traversal detected');
  }
  return resolved;
}

let movieBroadcast = null;
let config = { showForceQualityToast: true, showAutoRaiseToast: true };
let syncInterval = null;

export function setMovieBroadcast(fn) {
  movieBroadcast = fn;
}

function startSyncBroadcast() {
  if (syncInterval) return;
  syncInterval = setInterval(() => {
    if (movieBroadcast && isPlaying) {
      movieBroadcast(getPlaybackState());
    }
  }, 2000);
}

function stopSyncBroadcast() {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
  }
}

async function loadConfig() {
  try {
    const raw = readFileSync(join(__dirname, '..', 'config.json'), 'utf8');
    config = { ...config, ...JSON.parse(raw) };
  } catch {}
}

async function testEncoder(encoder) {
  try {
    await execFileAsync(
      'ffmpeg',
      ['-hide_banner', '-f', 'lavfi', '-i', 'testsrc=duration=1:size=320x240:rate=10', '-c:v', encoder, '-f', 'null', '-'],
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
    const { stdout } = await execFileAsync('ffmpeg', ['-hide_banner', '-encoders']);
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

export async function isBrowserCompatible(moviePath) {
  const ext = moviePath.slice(moviePath.lastIndexOf('.')).toLowerCase();
  if (ext !== '.mp4' && ext !== '.m4v') return false;
  try {
    const { stdout: v } = await execFileAsync(
      'ffprobe',
      ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', moviePath]
    );
    const { stdout: a } = await execFileAsync(
      'ffprobe',
      ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', moviePath]
    );
    return v.trim() === 'h264' && a.trim() === 'aac';
  } catch {
    return false;
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

async function probeDuration(moviePath) {
  try {
    const { stdout } = await execFileAsync(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', moviePath]
    );
    return parseFloat(stdout.trim());
  } catch {
    return 0;
  }
}

export async function verifyPlayable(filePath) {
  try {
    const { stdout } = await execFileAsync(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', filePath]
    );
    const duration = parseFloat(stdout.trim());
    return Number.isFinite(duration) && duration > 0;
  } catch {
    return false;
  }
}

function getFreeSpace(dir) {
  try {
    const stats = statfsSync(dir);
    return stats.bavail * stats.bsize;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function formatBytes(bytes) {
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  return `${(bytes / 1024 ** 2).toFixed(0)} MB`;
}

async function estimateQualityBytes(quality, duration, moviePath) {
  const preset = QUALITY_PRESETS.find(p => p.quality === quality);
  if (!preset) return 0;
  const bits = (parseFloat(preset.bitrate) * 1_000_000) + 128_000;
  let secs = duration;
  if (!secs || secs <= 0) secs = await probeDuration(moviePath);
  if (!secs || secs <= 0) {
    return preset.width >= 1920 ? 10 * 1024 ** 3 : preset.width >= 1280 ? 5 * 1024 ** 3 : 2.5 * 1024 ** 3;
  }
  return (bits / 8) * secs * 1.2;
}

function ensureDiskSpace(needed, dir = STREAM_DIR) {
  const free = getFreeSpace(dir);
  if (free < needed) {
    throw new Error(`Not enough disk space: need about ${formatBytes(needed)}, only ${formatBytes(free)} free`);
  }
}

function describeFFmpegFailure(code, stderr) {
  const text = String(stderr || '').toLowerCase();
  if (/no space left|enospc|disk full|write error/.test(text)) {
    return 'not enough disk space';
  }
  if (code === null) return 'ffmpeg was terminated';
  return `exit code ${code}`;
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

export function getStreamPath(movieName, quality) {
  if (!isSafeName(movieName)) throw new Error('Invalid movie name');
  if (!isValidQuality(quality)) throw new Error('Invalid quality');
  return safeJoin(STREAM_DIR, movieName, quality + '.mp4');
}

export function getStreamDir(movieName) {
  if (movieName) {
    if (!isSafeName(movieName)) throw new Error('Invalid movie name');
    const dir = safeJoin(STREAM_DIR, movieName);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    return dir;
  }
  return STREAM_DIR;
}

const REMUX_DIR = join(STREAM_DIR, '_remux');
const PREWARM_REMUX = ['1', 'true', 'yes', 'on'].includes(String(process.env.PREWARM_REMUX || '').toLowerCase());
const remuxInflight = new Map();

export function getRemuxPath(movieName, quality, audioIdx, subIdx) {
  if (!isSafeName(movieName)) throw new Error('Invalid movie name');
  if (!isValidQuality(quality)) throw new Error('Invalid quality');
  if (!Number.isInteger(audioIdx) || !Number.isInteger(subIdx)) throw new Error('Invalid track index');
  return safeJoin(REMUX_DIR, movieName, quality, `a${audioIdx}_s${subIdx}.mp4`);
}

export async function remuxForTracks(movieName, quality, audioIdx, subIdx) {
  const remuxPath = getRemuxPath(movieName, quality, audioIdx, subIdx);
  if (existsSync(remuxPath)) return remuxPath;
  if (remuxInflight.has(remuxPath)) return remuxInflight.get(remuxPath);

  const task = (async () => {
    mkdirSync(dirname(remuxPath), { recursive: true });
    const tmpPath = `${remuxPath}.tmp.mp4`;
    try { unlinkSync(tmpPath); } catch {}

    const src = getStreamPath(movieName, quality);

    const args = [
      '-i', src,
      '-map', '0:v:0',
      '-map', `0:a:${audioIdx}`,
    ];
    if (subIdx >= 0) {
      args.push('-map', `0:s:${subIdx}`);
    }
    args.push(
      '-c', 'copy',
      '-movflags', '+faststart',
      '-y', tmpPath
    );

    try {
      await new Promise((resolve, reject) => {
        const proc = spawn('ffmpeg', args);
        let stderr = '';
        proc.stderr?.on('data', (d) => {
          stderr += d.toString();
          if (stderr.length > 20000) stderr = stderr.slice(-20000);
        });
        proc.on('exit', (code) => {
          if (code === 0) resolve();
          else reject(new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-300)}`));
        });
        proc.on('error', reject);
      });
      renameSync(tmpPath, remuxPath);
    } catch (err) {
      try { unlinkSync(tmpPath); } catch {}
      throw err;
    }

    return remuxPath;
  })().finally(() => remuxInflight.delete(remuxPath));

  remuxInflight.set(remuxPath, task);
  return task;
}

export async function prewarmAudioTracks(movieName, quality) {
  if (!PREWARM_REMUX) return;
  try {
    const moviePath = join(MOVIE_DIR, movieName);
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=index', '-of', 'csv=p=0', moviePath
    ]);
    const count = stdout.trim().split(/\r?\n/).filter(Boolean).length;
    const limit = Math.min(count, 5);
    for (let i = 1; i < limit; i++) {
      await remuxForTracks(movieName, quality, i, -1).catch(() => {});
    }
  } catch (err) {
    logger.debug(`Audio prewarm failed for ${movieName}: ${err.message}`);
  }
}

function buildTranscodeArgs(moviePath, outputPath, quality) {
  const preset = QUALITY_PRESETS.find(q => q.quality === quality);
  const args = ['-i', moviePath];

  args.push('-map', '0:v:0');
  args.push('-map', '0:a');
  args.push('-map', '0:s?');

  if (encoderConfig.hardware && encoderConfig.vaapiDevice) {
    args.unshift('-vaapi_device', encoderConfig.vaapiDevice);
  }

  args.push('-vf', `scale=${preset.width}:${preset.height}`);
  args.push('-c:v', encoderConfig.encoder);

  if (encoderConfig.preset) {
    args.push('-preset', encoderConfig.preset);
  }
  if (!encoderConfig.hardware) {
    args.push('-tune', 'fastdecode');
  }
  if (encoderConfig.encoder === 'h264_vaapi') {
    args.push('-qp', '24');
  } else {
    args.push('-b:v', preset.bitrate);
  }
  args.push('-c:a', 'aac', '-b:a', '128k');
  args.push('-c:s', 'mov_text');
  args.push('-movflags', '+faststart', '-y', outputPath);

  return args;
}

function resetPlaybackState() {
  isPlaying = false;
  playbackStartTime = null;
  playbackOffset = 0;
  lastReportedPosition = 0;
  lastReportTime = 0;
  transcoding = false;
  transcodeProgress = 0;
  stopSyncBroadcast();
}

function resetPlaybackKeepCache() {
  isPlaying = false;
  playbackStartTime = null;
  playbackOffset = 0;
  lastReportedPosition = 0;
  lastReportTime = 0;
  stopSyncBroadcast();
}

export function updateHostPosition(position) {
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

export function getMovieDir() {
  return MOVIE_DIR;
}

export function getMusicDir() {
  return MUSIC_DIR;
}

export function getStreamDirBase() {
  return STREAM_DIR;
}

export function getDataDir() {
  return DATA_DIR;
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
        const { stdout } = await execFileAsync(
          'ffprobe',
          ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', filePath]
        );
        duration = Math.round(parseFloat(stdout.trim()));
      } catch {}

      const isCached = existsSync(getStreamPath(file, DEFAULT_QUALITY)) &&
        isCacheValid(getStreamPath(file, DEFAULT_QUALITY), fileStat);

      movies.push({
        name: file,
        displayName: file.replace(ext, '').replace(/[._-]/g, ' '),
        size: fileStat.size,
        duration,
        cached: isCached,
        qualities: QUALITY_PRESETS.map(q => q.quality),
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
  if (!isSafeName(movieName)) throw new Error('Invalid movie name');
  if (!isValidQuality(quality || DEFAULT_QUALITY)) throw new Error('Invalid quality');
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
  currentQuality = effectiveQuality;
  const streamPath = getStreamPath(movieName, effectiveQuality);

  if (existsSync(streamPath) && isCacheValid(streamPath, sourceStat)) {
    logger.info(`Cache hit: ${movieName}`);
    stopTranscoding();
    currentMovie = movieName;
    resetPlaybackKeepCache();
    deriveQualitiesInBackground(movieName, streamPath);
    prewarmAudioTracks(movieName, effectiveQuality);
    return getPlaybackState();
  }

  stopTranscoding();

  getStreamDir(movieName);

  const totalDuration = await probeDuration(moviePath);

  if (await isBrowserCompatible(moviePath)) {
    ensureDiskSpace(sourceStat.size * 1.1);
    logger.info(`Direct copy: ${movieName} (${effectiveQuality})`);
    copyFileSync(moviePath, streamPath);
    if (!(await verifyPlayable(streamPath))) {
      try { unlinkSync(streamPath); } catch {}
      throw new Error('Direct copy failed validation');
    }
    saveMeta(streamPath, sourceStat, true);
    currentMovie = movieName;
    resetPlaybackState();
    prewarmAudioTracks(movieName, effectiveQuality);
    return getPlaybackState();
  }

  ensureDiskSpace(await estimateQualityBytes(effectiveQuality, totalDuration, moviePath));
  logger.info(`Transcoding: ${movieName} (${effectiveQuality})`);

  saveMeta(streamPath, sourceStat, false);

  transcoding = true;
  transcodeProgress = 0;
  currentMovie = movieName;
  isPlaying = false;
  playbackStartTime = null;
  playbackOffset = 0;
  lastReportedPosition = 0;
  lastReportTime = 0;

  const tmpPath = `${streamPath}.tmp.mp4`;
  transcodeTmpPath = tmpPath;
  try { unlinkSync(tmpPath); } catch {}

  try {
    streamProcess = spawn('ffmpeg', buildTranscodeArgs(moviePath, tmpPath, effectiveQuality));

    let transcodeStderr = '';
    streamProcess.stderr?.on('data', (data) => {
      const output = data.toString();
      transcodeStderr += output;
      if (transcodeStderr.length > 20000) transcodeStderr = transcodeStderr.slice(-20000);
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

    streamProcess.on('exit', async (code) => {
      transcoding = false;
      streamProcess = null;
      if (code === 0) {
        const valid = await verifyPlayable(tmpPath);
        if (valid) {
          try { unlinkSync(streamPath); } catch {}
          renameSync(tmpPath, streamPath);
          transcodeTmpPath = null;
          transcodeProgress = 100;
          saveMeta(streamPath, sourceStat, true);
          deriveQualitiesInBackground(movieName, streamPath);
          prewarmAudioTracks(movieName, effectiveQuality);
        } else {
          logger.error(`Transcode output failed validation: ${movieName}`);
          try { unlinkSync(tmpPath); } catch {}
          transcodeTmpPath = null;
        }
      } else {
        logger.error(`Transcode failed (${describeFFmpegFailure(code, transcodeStderr)}): ${movieName}`);
        try { unlinkSync(tmpPath); } catch {}
        transcodeTmpPath = null;
      }
      movieBroadcast?.(getPlaybackState());
    });

    streamProcess.on('error', (err) => {
      logger.error(`Transcode error: ${err.message}`);
      transcoding = false;
      transcodeProgress = 0;
      streamProcess = null;
      try { unlinkSync(tmpPath); } catch {}
      transcodeTmpPath = null;
    });

  } catch (err) {
    transcoding = false;
    transcodeProgress = 0;
    throw new Error('Failed to start transcoding: ' + err.message);
  }

  return getPlaybackState();
}

export async function pausePlayback() {
  if (!isPlaying) return getPlaybackState();
  playbackOffset += (Date.now() - playbackStartTime) / 1000;
  lastReportedPosition = playbackOffset;
  lastReportTime = 0;
  isPlaying = false;
  playbackStartTime = null;
  stopSyncBroadcast();
  return getPlaybackState();
}

export async function resumePlayback() {
  if (isPlaying || !currentMovie) return getPlaybackState();
  isPlaying = true;
  playbackStartTime = Date.now();
  lastReportTime = Date.now();
  startSyncBroadcast();
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
  resetPlaybackState();
  return getPlaybackState();
}

export async function restorePlayback({ movie, quality, isPlaying: playing = false, currentTime = 0 } = {}) {
  if (typeof movie !== 'string' || !isSafeName(movie)) throw new Error('Invalid movie name');
  const requestedQuality = isValidQuality(quality) ? quality : DEFAULT_QUALITY;
  await playMovie(movie, requestedQuality);
  const offset = Number(currentTime);
  seekPlayback(Number.isFinite(offset) && offset > 0 ? offset : 0);
  if (playing) resumePlayback();
  else pausePlayback();
  return getPlaybackState();
}

export async function changeQuality(movieName, newQuality) {
  if (movieName !== currentMovie) {
    return playMovie(movieName, newQuality);
  }
  return getPlaybackState();
}

export async function deriveQualitiesInBackground(movieName, masterPath) {
  if (HQ_ONLY) return;
  const derivations = QUALITY_PRESETS.filter(p => p.quality !== DEFAULT_QUALITY);
  const moviePath = join(MOVIE_DIR, movieName);
  const duration = await probeDuration(moviePath);

  for (const preset of derivations) {
    const outputPath = getStreamPath(movieName, preset.quality);
    if (existsSync(outputPath)) continue;

    const needed = await estimateQualityBytes(preset.quality, duration, moviePath);
    const free = getFreeSpace(STREAM_DIR);
    if (free < needed) {
      logger.warn(`Derive skipped for ${preset.quality}: need about ${formatBytes(needed)}, only ${formatBytes(free)} free`);
      continue;
    }

    const ffmpegArgs = [
      '-i', masterPath,
      '-map', '0:v:0',
      '-map', '0:a',
      '-map', '0:s?',
      '-vf', `scale=${preset.width}:${preset.height}`,
      '-c:v', encoderConfig.encoder,
      ...(encoderConfig.preset ? ['-preset', encoderConfig.preset] : []),
      ...(!encoderConfig.hardware ? ['-tune', 'fastdecode'] : []),
      ...(encoderConfig.encoder === 'h264_vaapi' ? ['-qp', '24'] : ['-b:v', preset.bitrate]),
      '-c:a', 'aac', '-b:a', '128k',
      '-c:s', 'mov_text',
      '-movflags', '+faststart',
      '-y', outputPath,
    ];

    logger.info(`Deriving ${preset.quality} for ${movieName}: ffmpeg ${ffmpegArgs.join(' ')}`);

    try {
      await new Promise((resolve, reject) => {
        const proc = spawn('ffmpeg', ffmpegArgs);
        let stderr = '';
        proc.stderr?.on('data', (d) => { stderr += d.toString(); });
        proc.on('exit', (code) => {
          if (code === 0) resolve();
          else reject(new Error(`${describeFFmpegFailure(code, stderr)}: ${stderr.slice(-200)}`));
        });
        proc.on('error', reject);
      });

      if (!(await verifyPlayable(outputPath))) {
        try { unlinkSync(outputPath); } catch {}
        throw new Error('derived output failed validation');
      }
      const sourceStat = await stat(join(MOVIE_DIR, movieName));
      saveMeta(outputPath, sourceStat, true);
      logger.info(`Derived ${preset.quality} for ${movieName} (${stat(outputPath).size} bytes)`);
    } catch (err) {
      logger.error(`Derive failed: ${err.message}`);
    }
  }
}

function stopTranscoding() {
  if (streamProcess) {
    streamProcess.kill('SIGTERM');
    streamProcess = null;
  }
  if (transcodeTmpPath) {
    try { unlinkSync(transcodeTmpPath); } catch {}
    transcodeTmpPath = null;
  }
  transcoding = false;
  transcodeProgress = 0;
}

export async function initCache() {
  await loadConfig();
  if (!existsSync(STREAM_DIR)) return;
  const dirs = await readdir(STREAM_DIR);
  for (const dir of dirs) {
    if (dir.startsWith('_')) continue;
    const dirPath = join(STREAM_DIR, dir);
    const dirStat = await stat(dirPath);
    if (!dirStat.isDirectory()) continue;

    const temps = (await readdir(dirPath)).filter(f => f.endsWith('.tmp.mp4'));
    for (const temp of temps) {
      try { unlinkSync(join(dirPath, temp)); } catch {}
    }

    for (const preset of QUALITY_PRESETS) {
      const streamPath = join(dirPath, preset.quality + '.mp4');
      if (!existsSync(streamPath)) continue;

      if (!(await verifyPlayable(streamPath))) {
        try { unlinkSync(streamPath); } catch {}
        try { unlinkSync(getMetaPath(streamPath)); } catch {}
        logger.warn(`Invalid cache removed: ${dir}/${preset.quality}`);
        continue;
      }

      let meta = null;
      try { meta = getMeta(streamPath); } catch {}
      const needsMeta = !meta || !meta.complete;
      if (!needsMeta) continue;

      const sourcePath = join(MOVIE_DIR, dir);
      if (existsSync(sourcePath)) {
        saveMeta(streamPath, await stat(sourcePath), true);
        logger.info(`Rebuilt cache: ${dir}/${preset.quality}`);
      }
    }
  }
}
