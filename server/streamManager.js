import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import { mkdirSync, existsSync, copyFileSync, readFileSync, writeFileSync } from 'fs';
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

export { STREAM_DIR };

const VIDEO_EXTENSIONS = ['.mp4', '.mkv', '.avi', '.mov', '.webm', '.flv', '.wmv', '.m4v'];
const DEFAULT_QUALITY = '1080p';

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

const QUALITY_PRESETS = [
  { quality: '1080p', width: 1920, height: 1080, bitrate: '8M' },
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

let ioRef = null;
let config = { showForceQualityToast: true, showAutoRaiseToast: true };
let syncInterval = null;

export function setIoRef(io) {
  ioRef = io;
}

function startSyncBroadcast() {
  if (syncInterval) return;
  syncInterval = setInterval(() => {
    if (ioRef && isPlaying) {
      ioRef.emit('playbackUpdate', getPlaybackState());
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

export function getRemuxPath(movieName, quality, audioIdx, subIdx) {
  if (!isSafeName(movieName)) throw new Error('Invalid movie name');
  if (!isValidQuality(quality)) throw new Error('Invalid quality');
  if (!Number.isInteger(audioIdx) || !Number.isInteger(subIdx)) throw new Error('Invalid track index');
  return safeJoin(REMUX_DIR, movieName, quality, `a${audioIdx}_s${subIdx}.mp4`);
}

export async function remuxForTracks(movieName, quality, audioIdx, subIdx) {
  const remuxPath = getRemuxPath(movieName, quality, audioIdx, subIdx);
  if (existsSync(remuxPath)) return remuxPath;

  mkdirSync(dirname(remuxPath), { recursive: true });
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
    '-y', remuxPath
  );

  await execFileAsync('ffmpeg', args);
  return remuxPath;
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
  const streamPath = getStreamPath(movieName, effectiveQuality);

  if (existsSync(streamPath) && isCacheValid(streamPath, sourceStat)) {
    logger.info(`Cache hit: ${movieName}`);
    stopTranscoding();
    currentMovie = movieName;
    resetPlaybackKeepCache();
    deriveQualitiesInBackground(movieName, streamPath);
    return getPlaybackState();
  }

  stopTranscoding();

  getStreamDir(movieName);

  if (await isBrowserCompatible(moviePath)) {
    logger.info(`Direct copy: ${movieName} (${effectiveQuality})`);
    copyFileSync(moviePath, streamPath);
    saveMeta(streamPath, sourceStat, true);
    currentMovie = movieName;
    resetPlaybackState();
    return getPlaybackState();
  }

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

  try {
    const totalDuration = await probeDuration(moviePath);

    streamProcess = spawn('ffmpeg', buildTranscodeArgs(moviePath, streamPath, effectiveQuality));

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
        saveMeta(streamPath, sourceStat, true);
        deriveQualitiesInBackground(movieName, streamPath);
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

export async function changeQuality(movieName, newQuality) {
  if (movieName !== currentMovie) {
    return playMovie(movieName, newQuality);
  }
  return getPlaybackState();
}

export async function deriveQualitiesInBackground(movieName, masterPath) {
  const derivations = QUALITY_PRESETS.filter(p => p.quality !== DEFAULT_QUALITY);

  await Promise.all(derivations.map(async (preset) => {
    const outputPath = getStreamPath(movieName, preset.quality);
    if (existsSync(outputPath)) return;

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
          else reject(new Error(`exit code ${code}: ${stderr.slice(-200)}`));
        });
        proc.on('error', reject);
      });

      const sourceStat = await stat(join(MOVIE_DIR, movieName));
      saveMeta(outputPath, sourceStat, true);
      logger.info(`Derived ${preset.quality} for ${movieName} (${stat(outputPath).size} bytes)`);
    } catch (err) {
      logger.error(`Derive failed: ${err.message}`);
    }
  }));
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
  await loadConfig();
  if (!existsSync(STREAM_DIR)) return;
  const dirs = await readdir(STREAM_DIR);
  for (const dir of dirs) {
    const dirPath = join(STREAM_DIR, dir);
    const dirStat = await stat(dirPath);
    if (!dirStat.isDirectory()) continue;
    for (const preset of QUALITY_PRESETS) {
      const streamPath = join(dirPath, preset.quality + '.mp4');
      if (!existsSync(streamPath)) continue;
      if (!existsSync(getMetaPath(streamPath))) {
        const streamStat = await stat(streamPath);
        if (streamStat.size > 100 * 1024 * 1024) {
          const sourcePath = join(MOVIE_DIR, dir);
          if (existsSync(sourcePath)) {
            saveMeta(streamPath, await stat(sourcePath), true);
            logger.info(`Rebuilt cache: ${dir}/${preset.quality}`);
          }
        }
      }
    }
  }
}
