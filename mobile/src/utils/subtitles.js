const LANG_MAP = {
  eng: 'English', jpn: 'Japanese', ara: 'Arabic', cat: 'Catalan', cze: 'Czech',
  dan: 'Danish', ger: 'German', gre: 'Greek', spa: 'Spanish', baq: 'Basque',
  fin: 'Finnish', fil: 'Filipino', fre: 'French', glg: 'Galician', heb: 'Hebrew',
  hrv: 'Croatian', hun: 'Hungarian', ind: 'Indonesian', ita: 'Italian', kor: 'Korean',
  may: 'Malay', nob: 'Norwegian', dut: 'Dutch', pol: 'Polish', por: 'Portuguese',
  rum: 'Romanian', rus: 'Russian', swe: 'Swedish', tha: 'Thai', tur: 'Turkish',
  ukr: 'Ukrainian', vie: 'Vietnamese', chi: 'Chinese', und: 'Unknown',
};

export function formatLabel(lang, title) {
  const langName = LANG_MAP[lang] || String(lang || '').toUpperCase();
  if (title) return `${langName} (${title})`;
  return langName;
}

export function parseVtt(text) {
  const lines = text.trim().split(/\r?\n/);
  const entries = [];
  let current = null;
  for (const line of lines) {
    const timeMatch = line.match(/^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})[.,](\d{1,3})\s*-->\s*(?:(\d{1,2}):)?(\d{1,2}):(\d{2})[.,](\d{1,3})/);
    if (timeMatch) {
      if (current && current.text) entries.push(current);
      const h1 = timeMatch[1] ? parseInt(timeMatch[1]) : 0;
      const start = h1 * 3600 + parseInt(timeMatch[2]) * 60 + parseInt(timeMatch[3]) + parseInt(timeMatch[4].padEnd(3, '0')) / 1000;
      const h2 = timeMatch[5] ? parseInt(timeMatch[5]) : 0;
      const end = h2 * 3600 + parseInt(timeMatch[6]) * 60 + parseInt(timeMatch[7]) + parseInt(timeMatch[8].padEnd(3, '0')) / 1000;
      current = { start, end, text: '' };
    } else if (current && line.trim() && !line.startsWith('WEBVTT') && !line.startsWith('NOTE') && !line.match(/^\d+$/)) {
      const cleanLine = line.replace(/<[^>]+>/g, '').trim();
      if (cleanLine) {
        current.text += (current.text ? '\n' : '') + cleanLine;
      }
    }
  }
  if (current && current.text) entries.push(current);
  return entries;
}
