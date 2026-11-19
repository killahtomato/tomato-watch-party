const KEYS = {
  theme: 'twp.theme',
  accent: 'twp.accent',
  followSystem: 'twp.followSystem',
  reduceMotion: 'twp.reduceMotion',
  defaultQuality: 'twp.defaultQuality',
  autoplayNext: 'twp.autoplayNext',
  volume: 'twp.volume',
  showHealth: 'twp.showHealth',
  webSource: 'twp.webSource',
  webMode: 'twp.webMode',
  chatSize: 'twp.chatSize',
  subtitleSize: 'twp.subtitleSize',
  showSubtitles: 'twp.showSubtitles',
};

const DEFAULTS = {
  theme: 'dark',
  accent: 'red',
  followSystem: false,
  reduceMotion: false,
  defaultQuality: '1080p',
  autoplayNext: true,
  volume: 1,
  showHealth: true,
  webSource: 'all',
  webMode: 'sub',
  chatSize: 'md',
  subtitleSize: 'md',
  showSubtitles: true,
};

const QUALITIES = ['1080p', '720p', '480p'];
const WEB_SOURCES = ['all', 'aniwatch', 'gogoanime', '9anime', 'hianime', 'animegg', 'bilibili', 'youtube', 'nyaa', 'tpb'];
const WEB_MODES = ['sub', 'dub'];
const TEXT_SIZES = ['sm', 'md', 'lg'];

function isUnset(key) {
  try {
    return localStorage.getItem(KEYS[key]) === null;
  } catch {
    return true;
  }
}

function sanitize(key, value) {
  if (typeof DEFAULTS[key] === 'boolean') {
    if (typeof value === 'string') return value.trim().toLowerCase() === 'true';
    return Boolean(value);
  }
  if (typeof DEFAULTS[key] === 'number') {
    const num = Number(value);
    if (!Number.isFinite(num)) return DEFAULTS[key];
    if (key === 'volume') return Math.min(1, Math.max(0, num));
    return num;
  }
  if (key === 'defaultQuality') return QUALITIES.includes(value) ? value : DEFAULTS[key];
  if (key === 'webSource') return WEB_SOURCES.includes(value) ? value : DEFAULTS[key];
  if (key === 'webMode') return WEB_MODES.includes(value) ? value : DEFAULTS[key];
  if (key === 'chatSize') return TEXT_SIZES.includes(value) ? value : DEFAULTS[key];
  if (key === 'subtitleSize') return TEXT_SIZES.includes(value) ? value : DEFAULTS[key];
  if (key === 'theme') return value || DEFAULTS[key];
  if (key === 'accent') return value || DEFAULTS[key];
  return value || DEFAULTS[key];
}

export function getSettings() {
  const settings = { ...DEFAULTS };
  for (const key of Object.keys(KEYS)) {
    if (isUnset(key)) continue;
    try {
      const raw = localStorage.getItem(KEYS[key]);
      settings[key] = sanitize(key, raw);
    } catch {}
  }
  if (isUnset('reduceMotion') && typeof window !== 'undefined' && window.matchMedia) {
    settings.reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }
  return settings;
}

export function applySettings(settings = getSettings()) {
  const root = document.documentElement;
  const colorScheme = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  root.dataset.theme = settings.followSystem ? colorScheme : settings.theme;
  root.dataset.accent = settings.accent;
  root.dataset.motion = settings.reduceMotion ? 'reduced' : 'full';
  root.dataset.chatSize = settings.chatSize;
  root.dataset.subtitleSize = settings.subtitleSize;
}

export function updateSettings(patch) {
  const next = { ...getSettings() };
  for (const [key, value] of Object.entries(patch)) {
    if (!(key in KEYS)) continue;
    next[key] = sanitize(key, value);
    try {
      localStorage.setItem(KEYS[key], String(next[key]));
    } catch {}
  }
  applySettings(next);
  window.dispatchEvent(new CustomEvent('twp:settings', { detail: next }));
  return next;
}

let mediaBound = false;

export function initSettings() {
  applySettings();
  if (mediaBound || typeof window === 'undefined' || !window.matchMedia) return;
  mediaBound = true;
  try {
    window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
      if (getSettings().followSystem) applySettings();
    });
    window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', (event) => {
      if (isUnset('reduceMotion')) applySettings({ ...getSettings(), reduceMotion: event.matches });
    });
  } catch {}
}

export function getTheme() {
  return getSettings().theme;
}

export function getAccent() {
  return getSettings().accent;
}

export function setTheme(theme) {
  return updateSettings({ theme, followSystem: false });
}

export function setAccent(accent) {
  return updateSettings({ accent });
}
