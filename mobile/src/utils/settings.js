const KEY = 'twp:mobile-settings';

export function readSettings() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || {};
  } catch {
    return {};
  }
}

export function writeSettings(patch) {
  const settings = { ...readSettings(), ...patch };
  localStorage.setItem(KEY, JSON.stringify(settings));
}
