import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.JWT_SECRET = 'test-jwt-secret-not-default';
process.env.HOST_PASSWORD = 'test-host-password';
process.env.MOVIE_DIR = '/tmp/opencode/test-movies';
process.env.STREAM_DIR = '/tmp/opencode/test-streams';
process.env.LOG_FILE = join(tmpdir(), 'twp-test-server.log');

const auth = await import('../auth.js');
const sm = await import('../streamManager.js');
const orderStore = await import('../orderStore.js');

test('isSafeName rejects traversal and accepts normal names', () => {
  assert.equal(sm.isSafeName('Movie.mp4'), true);
  assert.equal(sm.isSafeName('My Movie (2024).mkv'), true);
  assert.equal(sm.isSafeName('../etc/passwd'), false);
  assert.equal(sm.isSafeName('..\\windows'), false);
  assert.equal(sm.isSafeName('a/b'), false);
  assert.equal(sm.isSafeName(''), false);
  assert.equal(sm.isSafeName('.'), false);
  assert.equal(sm.isSafeName('..'), false);
  assert.equal(sm.isSafeName('a\0b'), false);
  assert.equal(sm.isSafeName(null), false);
});

test('isValidQuality only accepts known presets', () => {
  assert.equal(sm.isValidQuality('1080p'), true);
  assert.equal(sm.isValidQuality('720p'), true);
  assert.equal(sm.isValidQuality('480p'), true);
  assert.equal(sm.isValidQuality('1080p; rm -rf /'), false);
  assert.equal(sm.isValidQuality('4k'), false);
  assert.equal(sm.isValidQuality(''), false);
  assert.equal(sm.isValidQuality(null), false);
});

test('safeJoin rejects traversal outside the base', () => {
  assert.throws(() => sm.safeJoin('/base', '../etc/passwd'), /traversal/i);
  assert.throws(() => sm.safeJoin('/base', 'sub/../../etc'), /traversal/i);
  assert.equal(sm.safeJoin('/base', 'sub', 'file.txt'), '/base/sub/file.txt');
  assert.equal(sm.safeJoin('/base', 'file.txt'), '/base/file.txt');
});

test('getStreamPath validates names and quality', () => {
  assert.throws(() => sm.getStreamPath('../x', '1080p'));
  assert.throws(() => sm.getStreamPath('movie', '1080p;id'));
  assert.equal(
    sm.getStreamPath('movie.mp4', '720p'),
    '/tmp/opencode/test-streams/movie.mp4/720p.mp4'
  );
});

test('getRemuxPath validates names, quality, and indices', () => {
  assert.throws(() => sm.getRemuxPath('../movie', '1080p', 0, -1));
  assert.throws(() => sm.getRemuxPath('movie', '1080p', '0', -1));
  assert.throws(() => sm.getRemuxPath('movie', '1080p', 0, 1.5));
  assert.doesNotThrow(() => sm.getRemuxPath('movie', '1080p', 0, -1));
});

test('verifyHostToken enforces the room', () => {
  const dj = auth.authenticateHost({ room: 'dj' });
  assert.equal(auth.verifyHostToken(dj, 'dj'), true);
  assert.equal(auth.verifyHostToken(dj, 'movie'), false);
  assert.equal(auth.verifyHostToken(dj), true);

  const movie = auth.authenticateHost();
  assert.equal(auth.verifyHostToken(movie, 'movie'), true);
  assert.equal(auth.verifyHostToken(movie, 'dj'), false);

  assert.equal(auth.verifyHostToken('not-a-token', 'movie'), false);
  assert.equal(auth.verifyHostToken(undefined, 'movie'), false);
});

test('verifyHostPassword compares safely', () => {
  assert.equal(auth.verifyHostPassword('test-host-password'), true);
  assert.equal(auth.verifyHostPassword('wrong'), false);
  assert.equal(auth.verifyHostPassword(''), false);
  assert.equal(auth.verifyHostPassword(undefined), false);
});

test('order store round-trips per room', () => {
  orderStore.setOrder('dj', ['b.mp3', 'a.flac']);
  orderStore.setOrder('movie', ['m1.mp4']);
  assert.deepEqual(orderStore.getOrder('dj'), ['b.mp3', 'a.flac']);
  assert.deepEqual(orderStore.getOrder('movie'), ['m1.mp4']);
  assert.deepEqual(orderStore.getOrder('bogus'), []);
});

test('order store drops unsafe names', () => {
  orderStore.setOrder('dj', ['ok.mp3', '../evil', 'a/b', '', null]);
  assert.deepEqual(orderStore.getOrder('dj'), ['ok.mp3']);
});

test('auth fails fast when JWT_SECRET is missing or default', () => {
  const serverDir = fileURLToPath(new URL('..', import.meta.url));
  const result = spawnSync(
    process.execPath,
    ['--input-type=module', '-e', "await import('./auth.js')"],
    {
      cwd: serverDir,
      env: { ...process.env, JWT_SECRET: '', HOST_PASSWORD: 'test-host-password' },
      encoding: 'utf8',
    }
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /JWT_SECRET/);
});
