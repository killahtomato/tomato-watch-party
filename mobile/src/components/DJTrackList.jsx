import { useState } from 'react';
import MobileSlidePanel from './MobileSlidePanel.jsx';
import { TRACK_SORTS, filterTracks, sortTracks } from '@client/utils/trackList.js';

export default function DJTrackList({ open, tracks, currentTrack, onClose }) {
  const [query, setQuery] = useState('');
  const [sortBy, setSortBy] = useState('name');
  const visibleTracks = sortTracks(filterTracks(tracks, query), sortBy);

  return (
    <MobileSlidePanel open={open} onClose={onClose} title={`Tracks (${tracks.length})`}>
      <div className="mobile-track-controls">
        <input
          type="search"
          className="mobile-track-search"
          placeholder="Search tracks…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          className="mobile-track-sort"
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value)}
          title="Sort tracks"
        >
          {TRACK_SORTS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </div>
      <div className="mobile-slide-list">
        {tracks.length === 0 && <p className="mobile-empty">No tracks found</p>}
        {tracks.length > 0 && visibleTracks.length === 0 && <p className="mobile-empty">No matching tracks</p>}
        {visibleTracks.map(track => (
          <div
            key={track.name}
            className={`mobile-track-row ${currentTrack === track.name ? 'active' : ''}`}
          >
            <span className="mobile-track-text">
              <span className="mobile-track-name">{track.title || track.displayName}</span>
              {track.artist && <span className="mobile-track-artist">{track.artist}</span>}
            </span>
            {currentTrack === track.name && <span className="mobile-track-playing">▶</span>}
          </div>
        ))}
      </div>
    </MobileSlidePanel>
  );
}
