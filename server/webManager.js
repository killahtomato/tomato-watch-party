let currentWeb = null;
let isPlaying = false;
let playbackStartTime = null;
let playbackOffset = 0;
let lastReportedPosition = 0;
let lastReportTime = 0;

function resetPlaybackState() {
  isPlaying = false;
  playbackStartTime = null;
  playbackOffset = 0;
  lastReportedPosition = 0;
  lastReportTime = 0;
}

export function updateWebHostPosition(position) {
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

export function getWebState() {
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
    web: currentWeb,
    isPlaying,
    currentTime: Math.max(0, currentTime),
  };
}

export function isWebActive() {
  return currentWeb !== null;
}

export function getCurrentWeb() {
  return currentWeb;
}

function normalizeDescriptor(descriptor) {
  if (!descriptor || typeof descriptor !== 'object') throw new Error('Invalid descriptor');
  const proxyUrl = String(descriptor.proxyUrl || '');
  if (!proxyUrl.startsWith('/api/web/stream')) throw new Error('Invalid stream URL');
  return {
    source: String(descriptor.source || '').slice(0, 40),
    id: String(descriptor.id || '').slice(0, 200),
    title: String(descriptor.title || '').slice(0, 200),
    episodeKey: String(descriptor.episodeKey || '').slice(0, 200),
    episodeNumber: descriptor.episodeNumber != null ? String(descriptor.episodeNumber).slice(0, 40) : '',
    mode: descriptor.mode === 'dub' ? 'dub' : 'sub',
    quality: String(descriptor.quality || '').slice(0, 20),
    type: String(descriptor.type || 'hls').slice(0, 20),
    proxyUrl,
    referrer: descriptor.referrer ? String(descriptor.referrer).slice(0, 500) : '',
    origin: descriptor.origin ? String(descriptor.origin).slice(0, 500) : '',
    subtitles: Array.isArray(descriptor.subtitles)
      ? descriptor.subtitles.slice(0, 5).map((sub) => ({
        lang: String(sub?.lang || 'und').slice(0, 20),
        url: String(sub?.url || '').slice(0, 500),
        proxyUrl: String(sub?.proxyUrl || '').slice(0, 1000),
      })).filter((sub) => sub.url && sub.proxyUrl.startsWith('/api/web/stream'))
      : [],
    live: descriptor.live === true,
  };
}

export function playWeb(descriptor) {
  const normalized = normalizeDescriptor(descriptor);
  currentWeb = normalized;
  resetPlaybackState();
  isPlaying = true;
  playbackStartTime = Date.now();
  lastReportTime = Date.now();
  return getWebState();
}

export function pauseWeb() {
  if (!isPlaying) return getWebState();
  playbackOffset += (Date.now() - playbackStartTime) / 1000;
  lastReportedPosition = playbackOffset;
  lastReportTime = 0;
  isPlaying = false;
  playbackStartTime = null;
  return getWebState();
}

export function resumeWeb() {
  if (isPlaying || !currentWeb) return getWebState();
  isPlaying = true;
  playbackStartTime = Date.now();
  lastReportTime = Date.now();
  return getWebState();
}

export function seekWeb(time) {
  const value = Number(time);
  if (!Number.isFinite(value) || value < 0) throw new Error('Invalid time');
  playbackOffset = value;
  lastReportedPosition = value;
  lastReportTime = Date.now();
  if (isPlaying) {
    playbackStartTime = Date.now();
  }
  return getWebState();
}

export function endWeb() {
  currentWeb = null;
  resetPlaybackState();
  return getWebState();
}
