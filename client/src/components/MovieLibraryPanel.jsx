import { useState, useCallback } from 'react';
import { getSettings } from '../utils/settings.js';

function formatTime(seconds) {
  if (!isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function MovieLibraryPanel({
  emit,
  movies = [],
  onReorderMovies,
  playbackState = null,
  open,
  onOpenChange,
}) {
  const [dragIndex, setDragIndex] = useState(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);

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

  const handlePlayMovie = (movieName) => {
    onOpenChange(false);
    emit('host:playMovie', { movie: movieName, quality: getSettings().defaultQuality }, (response) => {
      if (response?.error) alert(response.error);
    });
  };

  return (
    <>
      <div className={`movie-panel-tab${open ? ' open' : ''}`} onClick={() => onOpenChange(!open)}>
        🎬
      </div>

      <div className={`movie-panel${open ? ' open' : ''}`}>
        <div className="movie-panel-header">
          <h4>Select Movie</h4>
          <div className="movie-panel-actions">
            <button className="movie-panel-refresh" onClick={handleRefreshMovies} title="Refresh movie list">🔄</button>
            <button className="movie-panel-close" onClick={() => onOpenChange(false)}>✕</button>
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
    </>
  );
}
