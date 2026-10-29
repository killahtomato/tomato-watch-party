import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import { readdir, stat } from 'fs/promises';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';

const execAsync = promisify(exec);

const MOVIE_DIR = process.env.MOVIE_DIR || './movies';
const HLS_DIR = process.env.HLS_DIR || './hls';
const PORT = process.env.PORT || 3000;

const VIDEO_EXTENSIONS = ['.mp4', '.mkv', '.avi', '.mov', '.webm', '.flv', '.wmv', '.m4v'];

let currentMovie = null;
let isPlaying = false;
let playbackStartTime = null;
let playbackOffset = 0;
let ffmpegProcess = null;

export function getMovieDir() {
  return MOVIE_DIR;
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

      movies.push({
        name: file,
        displayName: file.replace(ext, '').replace(/[._-]/g, ' '),
        size: fileStat.size,
        duration,
      });
    }

    return movies.sort((a, b) => a.displayName.localeCompare(b.displayName));
  } catch {
    return [];
  }
}

export function getPlaybackState() {
  let currentTime = 0;
  if (isPlaying && playbackStartTime) {
    currentTime = playbackOffset + (Date.now() - playbackStartTime) / 1000;
  } else if (!isPlaying) {
    currentTime = playbackOffset;
  }

  return {
    movie: currentMovie,
    isPlaying,
    currentTime,
  };
}

export async function playMovie(movieName) {
  await stopTranscoding();

  const moviePath = join(MOVIE_DIR, movieName);
  if (!existsSync(moviePath)) {
    throw new Error('Movie not found');
  }

  if (!existsSync(HLS_DIR)) {
    mkdirSync(HLS_DIR, { recursive: true });
  } else {
    rmSync(HLS_DIR, { recursive: true, force: true });
    mkdirSync(HLS_DIR, { recursive: true });
  }

  const outputPath = join(HLS_DIR, 'index.m3u8');
  const segmentPath = join(HLS_DIR, 'segment_%03d.ts');

  ffmpegProcess = spawn('ffmpeg', [
    '-re',
    '-i', moviePath,
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-tune', 'zerolatency',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-hls_time', '4',
    '-hls_list_size', '0',
    '-hls_flags', 'delete_segments+omit_endlist',
    '-f', 'hls',
    outputPath,
  ]);

  ffmpegProcess.stderr?.on('data', () => {});
  ffmpegProcess.on('exit', () => {
    ffmpegProcess = null;
  });

  currentMovie = movieName;
  isPlaying = true;
  playbackStartTime = Date.now();
  playbackOffset = 0;

  return getPlaybackState();
}

export async function pausePlayback() {
  if (!isPlaying) return getPlaybackState();
  playbackOffset += (Date.now() - playbackStartTime) / 1000;
  isPlaying = false;
  playbackStartTime = null;
  return getPlaybackState();
}

export async function resumePlayback() {
  if (isPlaying || !currentMovie) return getPlaybackState();
  isPlaying = true;
  playbackStartTime = Date.now();
  return getPlaybackState();
}

export async function seekPlayback(time) {
  playbackOffset = time;
  if (isPlaying) {
    playbackStartTime = Date.now();
  }
  return getPlaybackState();
}

async function stopTranscoding() {
  if (ffmpegProcess) {
    ffmpegProcess.kill('SIGTERM');
    ffmpegProcess = null;
  }
}

export function getHlsDir() {
  return HLS_DIR;
}
