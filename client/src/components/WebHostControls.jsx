import { useState, useCallback, useEffect, useRef } from 'react';
import MovieLibraryPanel from './MovieLibraryPanel.jsx';
import ResumeToggle from './ResumeToggle.jsx';
import { useSettings } from '../hooks/useSettings.js';

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function WebHostControls({ emit, webState, seekRef, playRef, pauseRef, progress, movies = [], onReorderMovies, webPanelOpen, setWebPanelOpen, resumeOnStart = true, onResumePolicyChange, restoredAt }) {
  const [moviePanelOpen, setMoviePanelOpen] = useState(false);
  const [reactionsEnabled, setReactionsEnabled] = useState(true);
  const [dragPercent, setDragPercent] = useState(null);
  const [editSkips, setEditSkips] = useState(false);
  const settings = useSettings();
  const introDoneRef = useRef(false);
  const creditsDoneRef = useRef(false);

  const stream = webState?.web;
  const duration = progress?.duration || 0;
  const current = progress?.current || 0;
  const isLive = progress?.live || duration <= 0;
  const percent = duration > 0 ? Math.min(100, (current / duration) * 100) : 0;

  const skip = stream?.skip || null;
  const intro = skip?.intro || null;
  const credits = skip?.credits || null;

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

  const handleStop = useCallback(() => {
    pauseRef?.current?.();
    emit('web:ended', {});
  }, [pauseRef, emit]);

  const handleReactionsToggle = useCallback(() => {
    setReactionsEnabled((prev) => {
      const next = !prev;
      emit('host:reactions:toggle', { enabled: next });
      return next;
    });
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

  const seekTo = useCallback((time) => {
    if (!Number.isFinite(time)) return;
    seekRef?.current?.(time);
    emit('web:seek', { time });
  }, [seekRef, emit]);

  const handleSkipIntro = useCallback(() => {
    if (!intro) return;
    introDoneRef.current = true;
    seekTo(Math.min(intro.end, Math.max(0, duration - 0.1)));
  }, [intro, duration, seekTo]);

  const handleSkipCredits = useCallback(() => {
    if (!credits) return;
    creditsDoneRef.current = true;
    seekTo(Math.min(credits.end, Math.max(0, duration - 0.1)));
  }, [credits, duration, seekTo]);

  const handleMarkIntro = useCallback(() => {
    emit('web:setSkip', {
      skip: { intro: { start: 0, end: Math.max(1, current) }, credits },
    });
  }, [emit, current, credits]);

  const handleMarkCredits = useCallback(() => {
    emit('web:setSkip', {
      skip: { intro, credits: { start: Math.max(0, current), end: Math.max(current + 1, duration) } },
    });
  }, [emit, current, intro, duration]);

  const handleClearSkip = useCallback(() => {
    emit('web:clearSkip');
  }, [emit]);

  useEffect(() => {
    introDoneRef.current = false;
    creditsDoneRef.current = false;
    setEditSkips(false);
  }, [stream?.id, stream?.episodeKey]);

  useEffect(() => {
    if (isLive || !webState?.isPlaying) return;
    if (settings.autoSkipIntro && intro && !introDoneRef.current && current > 0.3 && current < intro.end) {
      introDoneRef.current = true;
      seekTo(Math.min(intro.end, Math.max(0, duration - 0.1)));
    }
    if (settings.autoSkipCredits && credits && !creditsDoneRef.current && current >= credits.start && current < credits.end) {
      creditsDoneRef.current = true;
      seekTo(Math.min(credits.end, Math.max(0, duration - 0.1)));
    }
  }, [current, isLive, webState?.isPlaying, settings.autoSkipIntro, settings.autoSkipCredits, intro, credits, duration, seekTo]);

  const introVisible = Boolean(intro && !isLive && duration > 0 && current >= intro.start && current < intro.end);
  const creditsVisible = Boolean(credits && !isLive && duration > 0 && current >= credits.start && current < Math.min(credits.end + 15, duration));

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

      <ResumeToggle
        resumeOnStart={resumeOnStart}
        onToggle={onResumePolicyChange}
        restoredAt={restoredAt}
        currentTime={current}
        duration={duration}
      />

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

      {stream && !isLive && (
        <div className="skip-row">
          {introVisible && (
            <button type="button" className="skip-btn" onClick={handleSkipIntro}>
              ⏭ Intro ({formatTime(intro.end)})
            </button>
          )}
          {creditsVisible && (
            <button type="button" className="skip-btn" onClick={handleSkipCredits}>
              ⏭ Credits ({formatTime(credits.start)})
            </button>
          )}
          <button
            type="button"
            className="skip-mark"
            onClick={() => setEditSkips(prev => !prev)}
            title="Edit skip markers"
          >
            ✎ Skips
          </button>
          {editSkips && (
            <>
              <div className="skip-readout">
                {intro ? `Intro ${formatTime(intro.start)}–${formatTime(intro.end)}` : 'Intro not set'}
              </div>
              <div className="skip-readout">
                {credits ? `Credits ${formatTime(credits.start)}–${formatTime(credits.end)}` : 'Credits not set'}
              </div>
              <button type="button" className="skip-mark" onClick={handleMarkIntro} title="Set the intro end at the current time">
                Mark intro end
              </button>
              <button type="button" className="skip-mark" onClick={handleMarkCredits} title="Set the credits start at the current time">
                Mark credits start
              </button>
              {stream.showKey && (
                <button type="button" className="skip-mark" onClick={handleClearSkip} title="Clear saved skips for this show">
                  Clear
                </button>
              )}
            </>
          )}
        </div>
      )}

      <div className="host-buttons">
        {stream && (
          <>
            <button onClick={handlePlayPause}>
              {webState?.isPlaying ? '⏸ Pause' : current > 0 ? '▶ Resume' : '▶ Play'}
            </button>
            <button onClick={handleResync} title="Force audience to resync">🔄 Resync</button>
            <button onClick={handleStop} className="stop-btn" title="Stop the stream">⏹ Stop</button>
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
          if (value) setWebPanelOpen(false);
        }}
      />

      <div
        className={`movie-panel-tab web-panel-tab${webPanelOpen ? ' open' : ''}`}
        onClick={() => {
          const next = !webPanelOpen;
          setWebPanelOpen(next);
          if (next) setMoviePanelOpen(false);
        }}
        title="Web search"
      >
        🌐
      </div>
    </div>
  );
}
