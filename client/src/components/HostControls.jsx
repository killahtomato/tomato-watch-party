import { useState, useEffect, useCallback } from 'react';

export default function HostControls({ emit, on }) {
  const [movies, setMovies] = useState([]);
  const [playbackState, setPlaybackState] = useState(null);

  useEffect(() => {
    fetch('/api/movies')
      .then((r) => r.json())
      .then((data) => setMovies(Array.isArray(data) ? data : []));

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
    emit('host:playMovie', { movie: movieName }, (response) => {
      if (response?.error) alert(response.error);
    });
  };

  const handlePause = () => emit('host:pause', {});
  const handleResume = () => emit('host:resume', {});

  const handleSeek = useCallback(
    (e) => {
      const time = parseFloat(e.target.value);
      emit('host:seek', { time });
    },
    [emit]
  );

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
          {playbackState.movie.replace(/\.[^.]+$/, '')}
          <span className="time">{formatTime(playbackState.currentTime)}</span>
        </div>
      )}

      {playbackState?.movie && movieDuration > 0 && (
        <div className="seek-bar">
          <input
            type="range"
            min={0}
            max={movieDuration}
            step={1}
            value={Math.min(playbackState.currentTime, movieDuration)}
            onChange={handleSeek}
          />
          <div className="seek-labels">
            <span>{formatTime(playbackState.currentTime)}</span>
            <span>{formatTime(movieDuration)}</span>
          </div>
        </div>
      )}

      <div className="host-buttons">
        {playbackState?.movie && (
          <>
            {playbackState.isPlaying ? (
              <button onClick={handlePause}>Pause</button>
            ) : (
              <button onClick={handleResume}>Resume</button>
            )}
          </>
        )}
      </div>

      <div className="movie-list">
        <h4>Select Movie</h4>
        {movies.length === 0 && <p>No movies found in folder.</p>}
        {movies.map((movie) => (
          <button
            key={movie.name}
            className={`movie-item ${playbackState?.movie === movie.name ? 'active' : ''}`}
            onClick={() => handlePlayMovie(movie.name)}
          >
            {movie.displayName}
            {movie.duration && <span className="duration">{formatTime(movie.duration)}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}
