import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const base = mkdtempSync(join(tmpdir(), 'twp-state-'));
process.env.STREAM_DIR = join(base, 'streams');
process.env.DATA_DIR = join(base, 'data');
process.env.LOG_FILE = join(tmpdir(), 'twp-state-test.log');

const store = await import('../stateStore.js');

test('round-trips a snapshot through disk', () => {
  const snap = {
    version: 1,
    movie: { movie: 'Film.mkv', quality: '720p', isPlaying: true, currentTime: 42.5 },
    dj: { track: 'Album/Song.flac', isPlaying: false, currentTime: 10 },
    web: {
      source: 'hianime',
      id: 'show',
      episodeKey: '3',
      mode: 'sub',
      title: 'Show',
      showKey: 'hianime:show',
      isPlaying: true,
      currentTime: 99,
      skip: { intro: { start: 31, end: 111 }, credits: { start: 1376, end: 1447 } },
    },
    chat: { movie: [{ id: 'a', name: 'Tom', text: 'hi', timestamp: 1, type: 'message', isHost: false }], dj: [] },
  };

  const written = store.writeStateFile(snap);
  assert.equal(written.movie.quality, '720p');
  assert.equal(written.web.showKey, 'hianime:show');
  assert.equal(written.chat.movie.length, 1);

  const read = store.readStateFile();
  assert.deepEqual(read.movie, snap.movie);
  assert.deepEqual(read.dj, snap.dj);
  assert.equal(read.web.isPlaying, true);
  assert.deepEqual(read.web.skip, { intro: { start: 31, end: 111 }, credits: { start: 1376, end: 1447 } });
  assert.equal(read.chat.movie[0].text, 'hi');
});

test('sanitizes bad values instead of trusting them', () => {
  assert.equal(store.sanitizeSnapshot(null), null);
  assert.equal(store.sanitizeSnapshot({ version: 999 }), null);

  const cleaned = store.sanitizeSnapshot({
    version: 1,
    movie: { movie: 'x', quality: 'bogus', isPlaying: 'yes', currentTime: -5 },
    web: { source: 's', id: 'i', mode: 'dub', currentTime: 'NaN' },
  });
  assert.equal(cleaned.movie.quality, '1080p');
  // Non-boolean flags fall back to a safe paused state rather than auto-playing.
  assert.equal(cleaned.movie.isPlaying, false);
  assert.equal(cleaned.movie.currentTime, 0);
  assert.equal(cleaned.web.mode, 'dub');
  assert.equal(cleaned.web.currentTime, 0);
});

test('missing or corrupt state file reads as null', () => {
  rmSync(store.statePath(), { force: true });
  assert.equal(store.readStateFile(), null);
});

test('cleanup', () => {
  rmSync(base, { recursive: true, force: true });
});
