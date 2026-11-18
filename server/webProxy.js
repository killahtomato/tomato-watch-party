import { isIP } from 'net';
import { once } from 'events';
import { issueStreamToken, verifyStreamToken } from './auth.js';
import { logger } from './logger.js';

const AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const FETCH_TIMEOUT_MS = Number(process.env.WEB_PROXY_TIMEOUT_MS || 30000);
const MAX_PLAYLIST_BYTES = 5 * 1024 * 1024;

function sendError(res, status, message) {
  if (res.headersSent) return;
  res.status(status).json({ error: message });
}

function isBlockedHost(hostname) {
  const value = String(hostname || '').toLowerCase();
  if (!value) return true;
  if (value === 'localhost' || value.endsWith('.localhost') || value === '0.0.0.0') return true;
  const literal = value.replace(/^\[|\]$/g, '');
  const version = isIP(literal);
  if (version === 4) {
    const [a, b] = literal.split('.').map(Number);
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    return false;
  }
  if (version === 6) {
    if (literal === '::' || literal === '::1') return true;
    const head = literal.split(':')[0].toLowerCase();
    return head.startsWith('fc') || head.startsWith('fd')
      || head.startsWith('fe8') || head.startsWith('fe9')
      || head.startsWith('fea') || head.startsWith('feb');
  }
  return false;
}

function resolveUri(uri, baseUrl) {
  try {
    const url = new URL(uri, baseUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.toString();
  } catch {
    return null;
  }
}

function proxyUrlFor(absUrl, token) {
  return `/api/web/stream?token=${encodeURIComponent(token)}&url=${encodeURIComponent(absUrl)}`;
}

function splitLines(text) {
  return text.split('\n').map(line => line.replace(/\r$/, ''));
}

function collectHosts(lines, baseUrl, baseHosts) {
  const hosts = new Set(baseHosts);
  for (const line of lines) {
    if (line.startsWith('#')) {
      for (const match of line.matchAll(/URI="([^"]*)"/g)) {
        const abs = resolveUri(match[1], baseUrl);
        if (abs) {
          try { hosts.add(new URL(abs).hostname); } catch {}
        }
      }
    } else if (line.trim() !== '') {
      const abs = resolveUri(line.trim(), baseUrl);
      if (abs) {
        try { hosts.add(new URL(abs).hostname); } catch {}
      }
    }
  }
  return hosts;
}

function rewriteLines(lines, baseUrl, token) {
  return lines.map((line) => {
    if (line.startsWith('#')) {
      return line.replace(/URI="([^"]*)"/g, (_match, uri) => {
        const abs = resolveUri(uri, baseUrl);
        return `URI="${abs ? proxyUrlFor(abs, token) : uri}"`;
      });
    }
    if (line.trim() === '') return line;
    const abs = resolveUri(line.trim(), baseUrl);
    return abs ? proxyUrlFor(abs, token) : line;
  });
}

export function buildStreamProxyUrl(url, { hosts, referrer = '', origin = '' }) {
  const token = issueStreamToken({ hosts, referrer, origin });
  return `/api/web/stream?token=${encodeURIComponent(token)}&url=${encodeURIComponent(url)}`;
}

export async function handleWebStream(req, res) {
  const token = String(req.query.token || '');
  const target = String(req.query.url || '');
  if (!token || !target) return sendError(res, 400, 'missing token or url');

  const decoded = verifyStreamToken(token);
  if (!decoded) return sendError(res, 401, 'invalid or expired token');

  let url;
  try {
    url = new URL(target);
  } catch {
    return sendError(res, 400, 'invalid url');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return sendError(res, 400, 'unsupported protocol');
  }
  if (isBlockedHost(url.hostname) || !decoded.hosts.includes(url.hostname)) {
    return sendError(res, 403, 'host not allowed');
  }

  const headers = { 'User-Agent': AGENT, 'Accept': '*/*' };
  if (decoded.referrer) headers.Referer = decoded.referrer;
  if (decoded.origin) headers.Origin = decoded.origin;
  if (req.headers.range) headers.Range = req.headers.range;

  let upstream;
  try {
    upstream = await fetch(url.toString(), {
      headers,
      redirect: 'error',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    logger.warn(`web proxy fetch failed for ${url.hostname}: ${err.message}`);
    return sendError(res, 504, 'upstream request failed');
  }

  if (!upstream.ok) {
    return sendError(res, upstream.status === 404 ? 404 : 502, 'upstream error');
  }

  const contentType = upstream.headers.get('content-type') || '';
  if (/mpegurl|m3u8/i.test(contentType)) {
    let text;
    try {
      text = await upstream.text();
    } catch {
      return sendError(res, 502, 'upstream read failed');
    }
    if (text.length > MAX_PLAYLIST_BYTES) return sendError(res, 502, 'playlist too large');
    const lines = splitLines(text);
    const hosts = collectHosts(lines, url.toString(), decoded.hosts);
    const playlistToken = issueStreamToken({
      hosts: [...hosts],
      referrer: decoded.referrer,
      origin: decoded.origin,
    });
    const rewritten = rewriteLines(lines, url.toString(), playlistToken).join('\n');
    res.status(200);
    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.setHeader('Cache-Control', 'no-store');
    return res.end(rewritten);
  }

  res.status(upstream.status);
  for (const name of ['content-type', 'content-length', 'accept-ranges', 'content-range', 'etag', 'last-modified']) {
    const value = upstream.headers.get(name);
    if (value != null) res.setHeader(name, value);
  }
  if (!res.hasHeader('Content-Type')) res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Cache-Control', 'no-store');

  try {
    if (!upstream.body) return res.end();
    for await (const chunk of upstream.body) {
      if (!res.write(chunk)) await once(res, 'drain');
    }
  } catch (err) {
    logger.warn(`web proxy stream error for ${url.hostname}: ${err.message}`);
    try { upstream.body?.destroy?.(); } catch {}
  } finally {
    res.end();
  }
}
