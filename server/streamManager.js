import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import { mkdirSync, existsSync, unlinkSync } from 'fs';
import { readdir, stat } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '..', '.env') });

const execAsync = promisify(exec);

const MOVIE_DIR = process.env.MOVIE_DIR || './movies';
const STREAM_DIR = process.env.STREAM_DIR || './streams';

const VIDEO_EXTENSIONS = ['.mp4', '.mkv', '.avi', '.mov', '.webm', '.flv', '.wmv', '.m4v'];

let currentMovie = null;
let isPlaying = false;
let playbackStartTime = null;
let playbackOffset = 0;
let streamProcess = null;

let lastReportedPosition = 0;
let lastReportTime = 0;

let transcoding = false;
let transcodeProgress = 0;

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
      const isCached = existsSync(streamFile);

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
  if (currentMovie === movieName && existsSync(getStreamPath(movieName))) {
    isPlaying = false;
    playbackStartTime = null;
    playbackOffset = 0;
    lastReportedPosition = 0;
    lastReportTime = 0;
    return getPlaybackState();
  }

  stopTranscoding();

  const moviePath = join(MOVIE_DIR, movieName);
  if (!existsSync(moviePath)) {
    throw new Error('Movie not found');
  }

  const streamPath = getStreamPath(movieName);

  if (existsSync(streamPath)) {
    unlinkSync(streamPath);
  }

  transcoding = true;
  transcodeProgress = 0;

  try {
    const { stdout: probeOut } = await execAsync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${moviePath}"`
    );
    const totalDuration = parseFloat(probeOut.trim());

    streamProcess = spawn('ffmpeg', [
      '-i', moviePath,
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-tune', 'film',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-movflags', '+faststart',
      '-y',
      streamPath,
    ]);

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
      }
      streamProcess = null;
    });

    streamProcess.on('error', (err) => {
      transcoding = false;
      streamProcess = null;
    });

  } catch (err) {
    transcoding = false;
    throw new Error('Failed to start transcoding: ' + err.message);
  }

  currentMovie = movieName;
  isPlaying = false;
  playbackStartTime = null;
  playbackOffset = 0;
  lastReportedPosition = 0;
  lastReportTime = 0;

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

function stopTranscoding() {
  if (streamProcess) {
    streamProcess.kill('SIGTERM');
    streamProcess = null;
  }
  transcoding = false;
  transcodeProgress = 0;
}
