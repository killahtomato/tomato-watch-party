import { useState, useEffect, useCallback, useRef } from 'react';

const QUALITY_PRESETS = ['1080p', '720p', '480p'];

export default function HostControls({ emit, on, playbackPercent, seekRef, playRef, pauseRef, onSeekPercent, movies = [], onReorderMovies }) {
  const [playbackState, setPlaybackState] = useState(null);
  const [dragTime, setDragTime] = useState(null);
  const [reactionsEnabled, setReactionsEnabled] = useState(true);
  const [moviesPanelOpen, setMoviesPanelOpen] = useState(false);
  const [forcedQuality, setForcedQuality] = useState(null);
  const [dragIndex, setDragIndex] = useState(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);
  const popupRef = useRef(null);

  useEffect(() => {
    const unsub = on('playbackUpdate', setPlaybackState);
    const unsubJoined = on('joined', (data) => {
      if (data.playbackState) setPlaybackState(data.playbackState);
    });

    return () => {
      unsub?.();
      unsubJoined?.();
    };
  }, [on]);

  const handleRefreshMovies = useCallback(() => {
    emit('host:refreshMovies', {}, (res) => {
      if (res?.error) console.error(res.error);
    });
  }, [emit]);

  const handleDragStart = useCallback((index) => (e) => {
    setDragIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(index));
  }, []);

  const handleDragOver = useCallback((index) => (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverIndex(index);
  }, []);

  const handleDrop = useCallback((index) => (e) => {
    e.preventDefault();
    const from = dragIndex ?? parseInt(e.dataTransfer.getData('text/plain'), 10);
    setDragIndex(null);
    setDragOverIndex(null);
    if (Number.isNaN(from) || from === index) return;
    const next = [...movies];
    const [moved] = next.splice(from, 1);
    next.splice(index, 0, moved);
    onReorderMovies?.(next);
  }, [dragIndex, movies, onReorderMovies]);

  const handleDragEnd = useCallback(() => {
    setDragIndex(null);
    setDragOverIndex(null);
  }, []);

  const handleResync = useCallback(() => {
    emit('host:resync', {});
  }, [emit]);

  const handlePlayMovie = (movieName) => {
    setMoviesPanelOpen(false);
    emit('host:playMovie', { movie: movieName, quality: '1080p' }, (response) => {
      if (response?.error) alert(response.error);
    });
  };

  const handlePause = () => {
    if (pauseRef?.current) pauseRef.current();
    emit('host:pause', {});
  };

  const handleResume = () => {
    if (playRef?.current) playRef.current();
    emit('host:resume', {});
  };

  const movieDuration = playbackState?.movie
    ? movies.find((m) => m.name === playbackState.movie)?.duration || 0
    : 0;

  const handleSkip = useCallback(
    (delta) => {
      const currentSec = (playbackPercent / 100) * movieDuration;
      const newTime = Math.max(0, Math.min(movieDuration, currentSec + delta));
      if (seekRef?.current) seekRef.current(newTime);
      emit('host:seek', { time: newTime });
    },
    [playbackPercent, movieDuration, seekRef, emit]
  );

  const handleSeek = useCallback(
    (e) => {
      const pct = parseFloat(e.target.value);
      setDragTime(pct);
      if (movieDuration > 0 && seekRef?.current) {
        seekRef.current((pct / 100) * movieDuration);
      }
    },
    [movieDuration, seekRef]
  );

  const handleSeekEnd = useCallback(
    (e) => {
      const pct = parseFloat(e.target.value);
      setDragTime(null);
      if (movieDuration > 0) {
        emit('host:seek', { time: (pct / 100) * movieDuration });
      }
      onSeekPercent(pct);
    },
    [movieDuration, emit, onSeekPercent]
  );

  const handleReactionsToggle = useCallback(() => {
    setReactionsEnabled(prev => {
      const next = !prev;
      emit('host:reactions:toggle', { enabled: next });
      return next;
    });
  }, [emit]);

  const handleForceQualityAll = useCallback(
    (quality) => {
      emit('host:forceQuality', { quality });
      setForcedQuality(quality);
    },
    [emit]
  );

  return (
    <div className="host-controls">
      <h3>Host Controls</h3>

      {playbackState?.movie && (
        <div className="now-playing">
          <span className="host-movie-title">{playbackState.movie.replace(/\.[^.]+$/, '')}</span>
          <span className="time">{formatTime((playbackPercent / 100) * movieDuration)} / {formatTime(movieDuration)}</span>
        </div>
      )}

      {playbackState?.movie && movieDuration > 0 && (
        <div className="seek-bar">
          <input
            type="range"
            min={0}
            max={100}
            step={0.1}
            value={dragTime !== null ? dragTime : Math.min(playbackPercent, 100)}
            onMouseDown={() => setDragTime(playbackPercent)}
            onTouchStart={() => setDragTime(playbackPercent)}
            onChange={handleSeek}
            onMouseUp={handleSeekEnd}
            onTouchEnd={handleSeekEnd}
          />
          <div className="seek-labels">
            <span>{formatTime((playbackPercent / 100) * movieDuration)}</span>
            <span>{formatTime(movieDuration)}</span>
          </div>
        </div>
      )}

      {playbackState?.movie && (
        <div className="skip-row">
          <button className="skip-btn" onClick={() => handleSkip(-10)}>⏪ 10s</button>
          <button className="skip-btn" onClick={() => handleSkip(10)}>⏩ 10s</button>
        </div>
      )}

      <div className="host-buttons">
        {playbackState?.movie && (
          <>
            {playbackState.isPlaying ? (
              <button onClick={handlePause}>⏸ Pause</button>
            ) : (
              <button onClick={handleResume}>
                {playbackPercent > 0 ? '▶ Resume' : '▶ Play'}
              </button>
            )}
            <button onClick={handleResync} title="Force audience to resync">🔄 Resync</button>
          </>
        )}
        <label className="reactions-toggle">
          <span className="reactions-icon">{reactionsEnabled ? '🍿' : '🚫'}</span>
          <input type="checkbox" checked={reactionsEnabled} onChange={handleReactionsToggle} />
          <span className="toggle-track"><span className="toggle-thumb"></span></span>
        </label>
      </div>

      <div className="force-quality-all">
        <span className="fq-label">Force quality:</span>
        <select
          className="fq-select"
          value={forcedQuality || 'none'}
          onChange={(e) => {
            if (e.target.value === 'none') {
              setForcedQuality(null);
              emit('host:forceQuality', { quality: playbackState?.quality || '1080p' });
            } else {
              handleForceQualityAll(e.target.value);
            }
          }}
        >
          <option value="none">None (auto)</option>
          {QUALITY_PRESETS.map(q => (
            <option key={q} value={q}>{q}</option>
          ))}
        </select>
      </div>

      <div className={`movie-panel-tab${moviesPanelOpen ? ' open' : ''}`} onClick={() => setMoviesPanelOpen(o => !o)}>
        🎬
      </div>

      <div className={`movie-panel${moviesPanelOpen ? ' open' : ''}`}>
        <div className="movie-panel-header">
          <h4>Select Movie</h4>
          <div className="movie-panel-actions">
            <button className="movie-panel-refresh" onClick={handleRefreshMovies} title="Refresh movie list">🔄</button>
            <button className="movie-panel-close" onClick={() => setMoviesPanelOpen(false)}>✕</button>
          </div>
        </div>
        <div className="movie-panel-list">
          {movies.length === 0 && <p>No movies found in folder.</p>}
          {movies.map((movie, index) => (
            <button
              key={movie.name}
              className={`movie-item ${playbackState?.movie === movie.name ? 'active' : ''} ${dragIndex === index ? 'dragging' : ''} ${dragOverIndex === index ? 'drag-over' : ''}`}
              onClick={() => handlePlayMovie(movie.name)}
              draggable
              onDragStart={handleDragStart(index)}
              onDragOver={handleDragOver(index)}
              onDrop={handleDrop(index)}
              onDragEnd={handleDragEnd}
            >
              <span className="movie-drag-handle" title="Drag to reorder">⋮⋮</span>
              <span>
                {movie.displayName}
                {movie.cached && <span className="movie-cached" title="Cached"></span>}
              </span>
              {movie.duration && <span className="duration">{formatTime(movie.duration)}</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function formatTime(seconds) {
  if (!isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}
