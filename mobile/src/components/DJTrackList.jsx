export default function DJTrackList({ tracks, currentTrack, onClose }) {
  return (
    <div className="mobile-slide-overlay" onClick={onClose}>
      <div className="mobile-slide-panel" onClick={(e) => e.stopPropagation()}>
        <div className="mobile-slide-header">
          <h3>Tracks ({tracks.length})</h3>
          <button className="mobile-slide-close" onClick={onClose}>✕</button>
        </div>
        <div className="mobile-slide-list">
          {tracks.length === 0 && <p className="mobile-empty">No tracks found</p>}
          {tracks.map(track => (
            <div
              key={track.name}
              className={`mobile-track-row ${currentTrack === track.name ? 'active' : ''}`}
            >
              <span className="mobile-track-name">{track.displayName}</span>
              {currentTrack === track.name && <span className="mobile-track-playing">▶</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
