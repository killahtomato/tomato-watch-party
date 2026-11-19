import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const musicDir = mkdtempSync(join(tmpdir(), 'twp-dj-'));
mkdirSync(join(musicDir, 'Album'), { recursive: true });
writeFileSync(join(musicDir, 'top.mp3'), 'not really audio');
writeFileSync(join(musicDir, 'Album', 'nested.flac'), 'not really audio');

process.env.MUSIC_DIR = musicDir;
process.env.STREAM_DIR = join(musicDir, '..', 'twp-dj-streams');
process.env.LOG_FILE = join(tmpdir(), 'twp-test-dj.log');

const dj = await import('../djManager.js');

test('dj library scans subdirectories and returns relative names', async () => {
  const list = await dj.getAudioFileList();
  const names = list.map(track => track.name).sort();
  assert.deepEqual(names, ['Album/nested.flac', 'top.mp3']);
});

test('relative path safety', () => {
  assert.equal(dj.isSafeRelativePath('Album/a.flac'), true);
  assert.equal(dj.isSafeRelativePath('../etc/passwd'), false);
  assert.equal(dj.isSafeRelativePath('/etc/passwd'), false);
  assert.equal(dj.isSafeRelativePath('a/../b'), false);
  assert.equal(dj.isSafeRelativePath('a\\b'), false);
});

test('shuffle and repeat state', () => {
  dj.setShuffle(true);
  dj.setRepeat('one');
  const state = dj.getPlaybackState();
  assert.equal(state.shuffle, true);
  assert.equal(state.repeat, 'one');

  dj.setRepeat('bogus');
  assert.equal(dj.getPlaybackState().repeat, 'off');

  dj.setShuffle(false);
  dj.setRepeat('all');
  assert.equal(dj.getPlaybackState().shuffle, false);
  assert.equal(dj.getPlaybackState().repeat, 'all');
});

test('cleanup', () => {
  rmSync(musicDir, { recursive: true, force: true });
});
