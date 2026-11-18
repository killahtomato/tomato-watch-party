import { useState, useCallback } from 'react';
import WebSearchPanel from './WebSearchPanel.jsx';
import MovieLibraryPanel from './MovieLibraryPanel.jsx';

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function WebHostControls({ emit, webState, seekRef, playRef, pauseRef, progress, movies = [], onReorderMovies }) {
  const [panelOpen, setPanelOpen] = useState(false);
  const [moviePanelOpen, setMoviePanelOpen] = useState(false);
  const [reactionsEnabled, setReactionsEnabled] = useState(true);
  const [dragPercent, setDragPercent] = useState(null);

  const stream = webState?.web;
  const duration = progress?.duration || 0;
  const current = progress?.current || 0;
  const isLive = progress?.live || duration <= 0;
  const percent = duration > 0 ? Math.min(100, (current / duration) * 100) : 0;

  const handlePlayPause = useCallback(() => {
    if (webState?.isPlaying) {
      pauseRef?.current?.();
      emit('web:pause', {});
    } else {
      playRef?.current?.();
      emit('web:resume', {});
    }
  }, [webState?.isPlaying, pauseRef, playRef, emit]);

  const handleResync = useCallback(() => {
    emit('web:resync', {});
  }, [emit]);

  const handleSeek = useCallback((e) => {
    const value = parseFloat(e.target.value);
    setDragPercent(value);
  }, []);

  const handleSeekEnd = useCallback((e) => {
    const value = parseFloat(e.target.value);
    setDragPercent(null);
    if (duration > 0) {
      const time = (value / 100) * duration;
      seekRef?.current?.(time);
      emit('web:seek', { time });
    }
  }, [duration, seekRef, emit]);

  const handleReactionsToggle = useCallback(() => {
    setReactionsEnabled((prev) => {
      const next = !prev;
      emit('host:reactions:toggle', { enabled: next });
      return next;
    });
  }, [emit]);

  const handlePlay = useCallback((descriptor) => {
    emit('web:play', descriptor, (response) => {
      if (response?.error) alert(response.error);
    });
    setPanelOpen(false);
  }, [emit]);

  return (
    <div className="host-controls web-host-controls">
      <h3>Web Controls</h3>

      {stream && (
        <div className="now-playing">
          <span className="host-movie-title">{stream.title}</span>
          <span className="time">
            {isLive ? 'LIVE' : `${formatTime(current)} / ${formatTime(duration)}`}
          </span>
        </div>
      )}

      {stream && !isLive && (
        <div className="seek-bar">
          <input
            type="range"
            min={0}
            max={100}
            step={0.1}
            value={dragPercent !== null ? dragPercent : percent}
            onChange={handleSeek}
            onMouseUp={handleSeekEnd}
            onTouchEnd={handleSeekEnd}
          />
          <div className="seek-labels">
            <span>{formatTime(current)}</span>
            <span>{formatTime(duration)}</span>
          </div>
        </div>
      )}

      <div className="host-buttons">
        {stream && (
          <>
            <button onClick={handlePlayPause}>
              {webState?.isPlaying ? '⏸ Pause' : current > 0 ? '▶ Resume' : '▶ Play'}
            </button>
            <button onClick={handleResync} title="Force audience to resync">🔄 Resync</button>
          </>
        )}
        <label className="reactions-toggle">
          <span className="reactions-icon">{reactionsEnabled ? '🍿' : '🚫'}</span>
          <input type="checkbox" checked={reactionsEnabled} onChange={handleReactionsToggle} />
          <span className="toggle-track"><span className="toggle-thumb"></span></span>
        </label>
      </div>

      <MovieLibraryPanel
        emit={emit}
        movies={movies}
        onReorderMovies={onReorderMovies}
        open={moviePanelOpen}
        onOpenChange={(value) => {
          setMoviePanelOpen(value);
          if (value) setPanelOpen(false);
        }}
      />

      <div
        className={`movie-panel-tab web-panel-tab${panelOpen ? ' open' : ''}`}
        onClick={() => {
          const next = !panelOpen;
          setPanelOpen(next);
          if (next) setMoviePanelOpen(false);
        }}
        title="Web search"
      >
        🌐
      </div>

      {panelOpen && (
        <div className="movie-panel web-panel open">
          <div className="movie-panel-header">
            <h4>Web Search</h4>
            <div className="movie-panel-actions">
              <button className="movie-panel-close" onClick={() => setPanelOpen(false)}>✕</button>
            </div>
          </div>
          <WebSearchPanel emit={emit} isHost onPlay={handlePlay} />
        </div>
      )}
    </div>
  );
}
