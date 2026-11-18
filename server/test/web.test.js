import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';

process.env.JWT_SECRET = 'test-jwt-secret-not-default';
process.env.HOST_PASSWORD = 'test-host-password';
process.env.MOVIE_DIR = '/tmp/opencode/test-movies';
process.env.STREAM_DIR = '/tmp/opencode/test-streams';
process.env.LOG_FILE = join(tmpdir(), 'twp-test-server.log');
process.env.TOMATOPLAY_ENABLED = '1';
process.env.TOMATOPLAY_BIN = '/nonexistent/tomato-play';

const auth = await import('../auth.js');
const web = await import('../webManager.js');
const bridge = await import('../tomatoBridge.js');
const proxy = await import('../webProxy.js');

const descriptor = {
  source: 'hianime',
  id: 'show-1',
  title: 'Show',
  episodeKey: '36652',
  episodeNumber: '1',
  mode: 'sub',
  quality: '1080p',
  type: 'hls',
  proxyUrl: '/api/web/stream?token=abc&url=https%3A%2F%2Fcdn.example%2Fmaster.m3u8',
};

test('webManager plays, pauses, resumes, seeks, and ends', () => {
  web.endWeb();
  let state = web.playWeb(descriptor);
  assert.equal(state.web.title, 'Show');
  assert.equal(state.isPlaying, true);
  assert.equal(web.isWebActive(), true);

  state = web.pauseWeb();
  assert.equal(state.isPlaying, false);
  assert.ok(state.currentTime >= 0);

  state = web.resumeWeb();
  assert.equal(state.isPlaying, true);

  state = web.seekWeb(42);
  assert.equal(state.currentTime, 42);

  state = web.endWeb();
  assert.equal(state.web, null);
  assert.equal(web.isWebActive(), false);
});

test('webManager rejects invalid descriptors and seek times', () => {
  web.endWeb();
  assert.throws(() => web.playWeb(null), /Invalid descriptor/);
  assert.throws(() => web.playWeb({ proxyUrl: 'https://evil.example/x' }), /Invalid stream URL/);
  assert.throws(() => web.playWeb({ ...descriptor, proxyUrl: '' }), /Invalid stream URL/);

  web.playWeb(descriptor);
  assert.throws(() => web.seekWeb(-1), /Invalid time/);
  assert.throws(() => web.seekWeb(NaN), /Invalid time/);
  assert.throws(() => web.seekWeb('x'), /Invalid time/);
  web.endWeb();
});

test('webManager host position drives the shared clock', () => {
  web.endWeb();
  web.playWeb(descriptor);
  web.updateWebHostPosition(10);
  const state = web.getWebState();
  assert.ok(state.currentTime >= 10);
  web.endWeb();
});

test('stream token is bound to its hosts', () => {
  const token = auth.issueStreamToken({
    hosts: ['cdn.example'],
    referrer: 'https://ref.example/',
    origin: 'https://ref.example',
  });
  const decoded = auth.verifyStreamToken(token);
  assert.ok(decoded);
  assert.deepEqual(decoded.hosts, ['cdn.example']);
  assert.equal(decoded.referrer, 'https://ref.example/');
  assert.equal(decoded.origin, 'https://ref.example');
  assert.equal(auth.verifyStreamToken('garbage'), null);
});

test('buildStreamProxyUrl yields a verifiable same-origin URL', () => {
  const url = proxy.buildStreamProxyUrl('https://cdn.example/master.m3u8', {
    hosts: ['cdn.example'],
    referrer: 'https://ref.example/',
    origin: 'https://ref.example',
  });
  assert.ok(url.startsWith('/api/web/stream?'));
  const token = new URL(url, 'http://localhost').searchParams.get('token');
  const decoded = auth.verifyStreamToken(token);
  assert.ok(decoded);
  assert.deepEqual(decoded.hosts, ['cdn.example']);
});

test('tomato bridge validates input before exec', async () => {
  await assert.rejects(() => bridge.tomatoSearch('', 'all'), /missing query/);
  await assert.rejects(() => bridge.tomatoSearch('q'.repeat(200), 'all'), /query too long/);
  await assert.rejects(() => bridge.tomatoSearch('q', 'bad'), /unknown source/);
  await assert.rejects(() => bridge.tomatoEpisodes('all', 'x'), /unknown source/);
  await assert.rejects(() => bridge.tomatoResolve('hianime', 'x', ''), /missing arguments/);
  await assert.rejects(() => bridge.tomatoResolve('hianime', 'x', '1', 'bad'), /unknown mode/);
});

test('tomato bridge reports disabled or missing binary status', () => {
  const status = bridge.tomatoStatus();
  assert.equal(status.enabled, true);
  assert.equal(status.available, false);
  assert.equal(status.bin, '/nonexistent/tomato-play');
});

test('tomato probe validates input and short-circuits empty lists', async () => {
  assert.deepEqual(await bridge.tomatoProbe([]), []);
  assert.deepEqual(await bridge.tomatoProbe(null), []);
  assert.deepEqual(await bridge.tomatoProbe([{ source: '', id: '' }, { source: 'aniwatch' }]), []);
  await assert.rejects(() => bridge.tomatoProbe([{ source: 'aniwatch', id: 'x' }]), /tomato-play not found/);
});

test('web proxy serves upstream bytes and blocks private redirect targets', async () => {
  const server = http.createServer((req, res) => {
    if (req.url === '/redirect') {
      res.writeHead(302, { location: `http://127.0.0.1:${server.address().port}/final` });
      res.end();
      return;
    }
    if (req.url === '/playlist') {
      res.writeHead(200, { 'content-type': 'application/vnd.apple.mpegurl' });
      res.end('#EXTM3U\n');
      return;
    }
    res.writeHead(200, { 'content-type': 'application/octet-stream' });
    res.end('ok');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const decoded = { hosts: ['127.0.0.1'], referrer: '', origin: '' };

  const ok = await proxy.fetchUpstream(`http://127.0.0.1:${port}/playlist`, decoded, null);
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('content-type'), 'application/vnd.apple.mpegurl');

  const blocked = await proxy.fetchUpstream(`http://127.0.0.1:${port}/redirect`, decoded, null);
  assert.equal(blocked.status, 302);

  server.close();
});
