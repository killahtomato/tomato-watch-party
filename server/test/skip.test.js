import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const base = mkdtempSync(join(tmpdir(), 'twp-skip-'));
process.env.MUSIC_DIR = base;
process.env.STREAM_DIR = join(base, '..', 'twp-skip-streams');
process.env.LOG_FILE = join(tmpdir(), 'twp-test-skip.log');

const store = await import('../skipStore.js');
const web = await import('../webManager.js');

test('skip profiles save, read, and clear', () => {
  const key = 'hianime:show-1';
  assert.equal(store.getSkipProfile(key), null);

  const profile = { intro: { start: 10, end: 90 }, credits: { start: 1200, end: 1300 } };
  const saved = store.setSkipProfile(key, profile);
  assert.deepEqual(saved, profile);
  assert.deepEqual(store.getSkipProfile(key), profile);

  store.setSkipProfile(key, null);
  assert.equal(store.getSkipProfile(key), null);
});

test('normalizeSkip keeps valid segments and rejects bad ones', () => {
  assert.deepEqual(
    web.normalizeSkip({ intro: { start: 5, end: 60 } }),
    { intro: { start: 5, end: 60 }, credits: null },
  );
  assert.deepEqual(
    web.normalizeSkip({ outro: { start: 100, end: 200 } }).credits,
    { start: 100, end: 200 },
  );
  assert.equal(web.normalizeSkip(null), null);
  assert.equal(web.normalizeSkip({}), null);
  assert.equal(web.normalizeSkip({ intro: { start: 90, end: 10 } }), null);
});

test('cleanup', () => {
  rmSync(base, { recursive: true, force: true });
});
