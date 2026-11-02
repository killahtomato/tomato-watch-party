import { readdir, stat } from 'fs/promises';
import { join } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { getMovieDir } from './streamManager.js';
import { logger } from './logger.js';

const execAsync = promisify(exec);

const AUDIO_EXTENSIONS = ['.mp3', '.flac', '.wav', '.ogg', '.m4a', '.aac', '.wma', '.opus'];

let currentTrack = null;
let isPlaying = false;
let playbackStartTime = null;
let playbackOffset = 0;
let lastReportedPosition = 0;
let lastReportTime = 0;
let playlist = [];

export async function getAudioFileList() {
  try {
    const movieDir = getMovieDir();
    const files = await readdir(movieDir);
    const tracks = [];

    for (const file of files) {
      const ext = file.lastIndexOf('.') > 0 ? file.slice(file.lastIndexOf('.')).toLowerCase() : '';
      if (!AUDIO_EXTENSIONS.includes(ext)) continue;

      const filePath = join(movieDir, file);
      const fileStat = await stat(filePath);

      let duration = null;
      try {
        const { stdout } = await execAsync(
          `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`
        );
        duration = Math.round(parseFloat(stdout.trim()));
      } catch {}

      tracks.push({
        name: file,
        displayName: file.replace(ext, '').replace(/[._-]/g, ' '),
        size: fileStat.size,
        duration,
      });
    }

    playlist = tracks.sort((a, b) => a.displayName.localeCompare(b.displayName));
    return playlist;
  } catch {
    return [];
  }
}

export function getPlaylist() {
  return playlist;
}

export async function playTrack(trackName) {
  const movieDir = getMovieDir();
  const filePath = join(movieDir, trackName);
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
