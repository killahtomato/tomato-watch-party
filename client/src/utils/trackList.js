export const TRACK_SORTS = [
  ['name', 'Name'],
  ['artist', 'Artist'],
  ['album', 'Album'],
  ['duration', 'Duration'],
];

function titleOf(track) {
  return track.title || track.displayName || track.name || '';
}

export function trackSearchText(track) {
  return [track.title, track.artist, track.album, track.displayName, track.name]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

export function filterTracks(tracks, query) {
  const text = String(query || '').trim().toLowerCase();
  if (!text) return [...tracks];
  return tracks.filter(track => trackSearchText(track).includes(text));
}

export function sortTracks(tracks, sortBy) {
  const sorted = [...tracks];
  switch (sortBy) {
    case 'duration':
      sorted.sort((a, b) => (b.duration || 0) - (a.duration || 0));
      break;
    case 'artist':
      sorted.sort((a, b) =>
        String(a.artist || titleOf(a)).localeCompare(String(b.artist || titleOf(b)))
        || String(a.album || '').localeCompare(String(b.album || ''))
        || titleOf(a).localeCompare(titleOf(b)));
      break;
    case 'album':
      sorted.sort((a, b) =>
        String(a.album || 'Unknown album').localeCompare(String(b.album || 'Unknown album'))
        || (parseInt(a.track, 10) || 0) - (parseInt(b.track, 10) || 0)
        || titleOf(a).localeCompare(titleOf(b)));
      break;
    default:
      sorted.sort((a, b) => titleOf(a).localeCompare(titleOf(b)));
  }
  return sorted;
}

export function computeNextTrack(tracks, currentName, shuffle, repeat) {
  if (!Array.isArray(tracks) || tracks.length === 0) return null;
  const currentIndex = tracks.findIndex(track => track.name === currentName);

  if (repeat === 'one') return tracks[currentIndex] || tracks[0];

  if (shuffle && tracks.length > 1) {
    let nextIndex = currentIndex;
    while (nextIndex === currentIndex) {
      nextIndex = Math.floor(Math.random() * tracks.length);
    }
    return tracks[nextIndex];
  }

  if (currentIndex >= 0 && currentIndex + 1 < tracks.length) return tracks[currentIndex + 1];
  if (repeat === 'all') return tracks[0];
  return null;
}

export function groupTracksByAlbum(tracks) {
  const groups = [];
  const index = new Map();
  for (const track of tracks) {
    const key = track.album || 'Unknown album';
    if (!index.has(key)) {
      index.set(key, groups.length);
      groups.push({ album: key, tracks: [] });
    }
    groups[index.get(key)].tracks.push(track);
  }
  return groups;
}
