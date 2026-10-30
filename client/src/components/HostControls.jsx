import { useState, useEffect, useCallback } from 'react';

export default function HostControls({ emit, on, currentTime, seekRef, playRef, pauseRef }) {
  const [movies, setMovies] = useState([]);
  const [playbackState, setPlaybackState] = useState(null);
  const [dragTime, setDragTime] = useState(null);
  const [reactionsEnabled, setReactionsEnabled] = useState(true);
  const [moviesPanelOpen, setMoviesPanelOpen] = useState(false);

  useEffect(() => {
    fetch('/api/movies')
      .then((r) => r.json())
      .then(setMovies);

    const unsub = on('playbackUpdate', setPlaybackState);
    const unsubJoined = on('joined', (data) => {
      if (data.playbackState) setPlaybackState(data.playbackState);
    });

    return () => {
      unsub?.();
      unsubJoined?.();
    };
  }, [on]);

  const handlePlayMovie = (movieName) => {
    setMoviesPanelOpen(false);
    emit('host:playMovie', { movie: movieName }, (response) => {
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

  const handleSkip = useCallback(
    (delta) => {
      const newTime = Math.max(0, currentTime + delta);
      if (seekRef?.current) seekRef.current(newTime);
      emit('host:seek', { time: newTime });
    },
    [currentTime, seekRef, emit]
  );

  const handleSeek = useCallback(
    (e) => {
      const time = parseFloat(e.target.value);
      setDragTime(time);
      if (seekRef?.current) {
        seekRef.current(time);
      }
    },
    [seekRef]
  );

  const handleSeekEnd = useCallback(
    (e) => {
      const time = parseFloat(e.target.value);
      emit('host:seek', { time });
    },
    [emit]
  );

  const handleReactionsToggle = useCallback(() => {
    setReactionsEnabled(prev => {
      const next = !prev;
      emit('host:reactions:toggle', { enabled: next });
      return next;
    });
  }, [emit]);

  const formatTime = (seconds) => {
    if (!isFinite(seconds) || seconds < 0) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const movieDuration = playbackState?.movie
    ? movies.find((m) => m.name === playbackState.movie)?.duration || 0
    : 0;

  return (
    <div className="host-controls">
      <h3>Host Controls</h3>

      {playbackState?.movie && (
        <div className="now-playing">
          <span className="host-movie-title">{playbackState.movie.replace(/\.[^.]+$/, '')}</span>
          <span className="time">{formatTime(currentTime)} / {formatTime(movieDuration)}</span>
        </div>
      )}

      {playbackState?.movie && movieDuration > 0 && (
        <div className="seek-bar">
          <input
            type="range"
            min={0}
            max={movieDuration}
            step={1}
            value={dragTime !== null ? dragTime : Math.min(currentTime, movieDuration)}
            onMouseDown={() => setDragTime(currentTime)}
            onTouchStart={() => setDragTime(currentTime)}
            onMouseUp={() => setDragTime(null)}
            onTouchEnd={() => setDragTime(null)}
            onChange={handleSeek}
            onMouseUp={handleSeekEnd}
            onTouchEnd={handleSeekEnd}
          />
          <div className="seek-labels">
            <span>{formatTime(currentTime)}</span>
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
                {currentTime > 0 ? '▶ Resume' : '▶ Play'}
              </button>
            )}
          </>
        )}
        <label className="reactions-toggle">
          <span className="reactions-icon">{reactionsEnabled ? '🍿' : '🚫'}</span>
          <input
            type="checkbox"
            checked={reactionsEnabled}
            onChange={handleReactionsToggle}
          />
          <span className="toggle-track"><span className="toggle-thumb"></span></span>
        </label>
      </div>

      <div className={`movie-panel-tab${moviesPanelOpen ? ' open' : ''}`} onClick={() => setMoviesPanelOpen(o => !o)}>
        🎬
      </div>

      <div className={`movie-panel${moviesPanelOpen ? ' open' : ''}`}>
        <div className="movie-panel-header">
          <h4>Select Movie</h4>
          <button className="movie-panel-close" onClick={() => setMoviesPanelOpen(false)}>✕</button>
        </div>
        <div className="movie-panel-list">
          {movies.length === 0 && <p>No movies found in folder.</p>}
          {movies.map((movie) => (
            <button
              key={movie.name}
              className={`movie-item ${playbackState?.movie === movie.name ? 'active' : ''}`}
              onClick={() => handlePlayMovie(movie.name)}
            >
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
