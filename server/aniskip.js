const ANILIST_URL = 'https://graphql.anilist.co';
const ANISKIP_URL = 'https://api.aniskip.com/v2/skip-times';
const AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const cache = new Map();

function normalizeTitle(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function titleScore(candidate, title) {
  const a = normalizeTitle(candidate);
  const b = normalizeTitle(title);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.85;
  const left = new Set(a.split(' ').filter(Boolean));
  const right = new Set(b.split(' ').filter(Boolean));
  let hits = 0;
  for (const word of left) if (right.has(word)) hits += 1;
  return hits / Math.max(left.size, right.size);
}

async function searchAniList(title) {
  const query = 'query ($search: String) { Page(perPage: 5) { media(search: $search, type: ANIME) { id idMal title { romaji english userPreferred } } } }';
  const response = await fetch(ANILIST_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': AGENT },
    body: JSON.stringify({ query, variables: { search: title } }),
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) return [];
  const data = await response.json();
  return Array.isArray(data?.data?.Page?.media) ? data.data.Page.media : [];
}

function pickMedia(media, title) {
  let best = null;
  let bestScore = 0;
  for (const item of media) {
    for (const candidate of [item?.title?.romaji, item?.title?.english, item?.title?.userPreferred]) {
      const score = titleScore(candidate, title);
      if (score > bestScore) {
        bestScore = score;
        best = item;
      }
    }
  }
  return bestScore >= 0.6 ? best : null;
}

function parseSkipResults(results) {
  let intro = null;
  let credits = null;
  for (const result of results || []) {
    const start = Number(result?.interval?.startTime);
    const end = Number(result?.interval?.endTime);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    if (result.skipType === 'op') intro = { start, end };
    else if (result.skipType === 'ed') credits = { start, end };
  }
  if (!intro && !credits) return null;
  return { intro, credits };
}

export async function lookupSkipTimes({ title, episode, episodeLength }) {
  if (!title) return null;
  const numericEpisode = Number(episode);
  if (!Number.isFinite(numericEpisode) || numericEpisode <= 0) return null;

  const key = `${normalizeTitle(title)}:${numericEpisode}`;
  if (cache.has(key)) return cache.get(key);

  let skip = null;
  try {
    const media = await searchAniList(title);
    const match = pickMedia(media, title);
    if (match?.idMal) {
      const length = Number.isFinite(Number(episodeLength)) ? Math.round(Number(episodeLength)) : 1440;
      const url = `${ANISKIP_URL}/${match.idMal}/${numericEpisode}?types%5B%5D=op&types%5B%5D=ed&episodeLength=${length}`;
      const response = await fetch(url, { headers: { 'User-Agent': AGENT }, signal: AbortSignal.timeout(5000) });
      if (response.ok) {
        const data = await response.json();
        skip = parseSkipResults(data?.results);
      }
    }
  } catch {
    skip = null;
  }

  cache.set(key, skip);
  return skip;
}
