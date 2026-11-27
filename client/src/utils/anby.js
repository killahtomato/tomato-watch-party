export const ANBY_THEMES = ['anby', 'anby-alt', 'anby-tactical'];

export const ANBY_REACTIONS = ['🍔', '⚡', '🍜', '❤️'];

export function isAnbyTheme(theme) {
  return ANBY_THEMES.includes(theme);
}

export function reactionsFor(theme, fallback) {
  return isAnbyTheme(theme) ? ANBY_REACTIONS : fallback;
}
