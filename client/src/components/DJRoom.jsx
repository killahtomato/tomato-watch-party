import { useEffect, useRef, useState, useCallback } from 'react';
import AudioVisualizer from './AudioVisualizer.jsx';
import { applyOrder } from '../utils/order.js';

export default function DJRoom({ emit, on, sessionData, isDJ, onDJLogin, isActive = true, seekRef, playRef, pauseRef, onSeekPercent, onPercentUpdate, playbackPercent = 0 }) {
  const audioRef = useRef(null);
  const playbackRef = useRef({ isPlaying: false, currentTime: 0 });
  const wasPlayingBeforeSeekRef = useRef(false);
  const resumeAfterSeekRef = useRef(false);
  const seekResumeTimeoutRef = useRef(null);
  const seekInProgressRef = useRef(false);
  const lastSeekTime = useRef(0);
  const initializedTrackRef = useRef(null);
  const [tracks, setTracks] = useState([]);
  const [playbackState, setPlaybackState] = useState({ track: null, isPlaying: false, currentTime: 0 });
  const [dragTime, setDragTime] = useState(null);
  const [reactions, setReactions] = useState([]);
  const [reactionsEnabled, setReactionsEnabled] = useState(true);
  const [trackListOpen, setTrackListOpen] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [dragIndex, setDragIndex] = useState(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);

  const tracksRef = useRef(tracks);
  tracksRef.current = tracks;
  const currentTrackRef = useRef(playbackState.track);
  currentTrackRef.current = playbackState.track;

  const trackUrl = playbackState.track
    ? `/api/audio-file/${encodeURIComponent(playbackState.track)}`
    : null;

  const loadTracks = useCallback(() => {
    Promise.all([
      fetch('/api/audio-files').then(r => r.json()).catch(() => []),
      fetch('/api/order/dj').then(r => r.json()).catch(() => ({ order: [] })),
    ]).then(([list, orderData]) => {
      const trackList = Array.isArray(list) ? list : [];
      const savedOrder = Array.isArray(orderData?.order) ? orderData.order : [];
      setTracks(applyOrder(trackList, savedOrder));
    });
  }, []);

  useEffect(() => {
    loadTracks();
  }, [loadTracks]);

  useEffect(() => {
    const unsub = on('orderUpdate', (data) => {
      if (data?.room === 'dj') {
        setTracks(prev => applyOrder(prev, Array.isArray(data.order) ? data.order : []));
      }
    });
    return () => unsub?.();
  }, [on]);

  const handleRefreshTracks = useCallback(() => {
    loadTracks();
  }, [loadTracks]);

  const handleDragStart = useCallback((index) => (e) => {
    if (!isDJ) return;
    setDragIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(index));
  }, [isDJ]);

  const handleDragOver = useCallback((index) => (e) => {
    if (!isDJ) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverIndex(index);
  }, [isDJ]);

  const handleDrop = useCallback((index) => (e) => {
    if (!isDJ) return;
    e.preventDefault();
    const from = dragIndex ?? parseInt(e.dataTransfer.getData('text/plain'), 10);
    setDragIndex(null);
    setDragOverIndex(null);
    if (Number.isNaN(from) || from === index) return;
    const next = [...tracks];
    const [moved] = next.splice(from, 1);
    next.splice(index, 0, moved);
    setTracks(next);
    emit('dj:setOrder', { order: next.map(t => t.name) }, (res) => {
      if (res?.error) console.error(res.error);
    });
  }, [dragIndex, tracks, emit, isDJ]);

  const handleDragEnd = useCallback(() => {
    setDragIndex(null);
    setDragOverIndex(null);
  }, []);

  useEffect(() => {
    if (seekRef) seekRef.current = (time) => { if (audioRef.current) audioRef.current.currentTime = time; };
    if (playRef) playRef.current = () => { if (audioRef.current) audioRef.current.play().catch(() => {}); };
    if (pauseRef) pauseRef.current = () => { if (audioRef.current) audioRef.current.pause(); };
  }, [seekRef, playRef, pauseRef]);

  useEffect(() => {
    if (!audioRef.current || !trackUrl) return;

    const onCanPlay = () => {
      if (initializedTrackRef.current === trackUrl) return;
      initializedTrackRef.current = trackUrl;

      const saved = playbackRef.current.currentTime;
      if (saved > 0) audioRef.current.currentTime = saved;
      if (playbackRef.current.isPlaying) {
        audioRef.current.play().catch(() => {});
      }
    };

    audioRef.current.addEventListener('canplay', onCanPlay);
    audioRef.current.src = trackUrl;

    return () => audioRef.current?.removeEventListener('canplay', onCanPlay);
  }, [trackUrl]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleTimeUpdate = () => {
      playbackRef.current.currentTime = audio.currentTime;
      if (audio.duration > 0) {
        onPercentUpdate?.(Math.round((audio.currentTime / audio.duration) * 1000) / 10);
      }
    };
    const handleSeeked = () => {
      lastSeekTime.current = Date.now();
      if (resumeAfterSeekRef.current) {
        resumeAfterSeekRef.current = false;
        clearTimeout(seekResumeTimeoutRef.current);
        playbackRef.current.isPlaying = true;
        emit('dj:resume', {});
        audio.play().catch((error) => console.error('[DJ] Resume after seek failed:', error));
      }
      if (audio.duration > 0) {
        onPercentUpdate?.(Math.round((audio.currentTime / audio.duration) * 1000) / 10);
      }
    };
  const handleEnded = () => {
    if (!isDJ) return;
    const currentIndex = tracksRef.current.findIndex(t => t.name === currentTrackRef.current);
    const nextIndex = (currentIndex + 1) % tracksRef.current.length;
    const nextTrack = tracksRef.current[nextIndex];
    if (nextTrack) {
      emit('dj:play', { track: nextTrack.name }, () => {
        emit('dj:resume', {});
      });
    }
  };
  const handlePlay = () => { playbackRef.current.isPlaying = true; };
  const handlePause = () => { playbackRef.current.isPlaying = false; };

    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('seeked', handleSeeked);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('play', handlePlay);
    audio.addEventListener('pause', handlePause);

    const poll1 = setInterval(() => {
      const since = Date.now() - lastSeekTime.current;
      if (since > 2000 && audio.duration > 0) {
        onPercentUpdate?.(Math.round((audio.currentTime / audio.duration) * 1000) / 10);
      }
    }, 200);

    const poll2 = setInterval(() => {
      const since = Date.now() - lastSeekTime.current;
      if (since < 2000 && audio.duration > 0) {
        onPercentUpdate?.(Math.round((audio.currentTime / audio.duration) * 1000) / 10);
      }
    }, 100);

    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('seeked', handleSeeked);
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('play', handlePlay);
      audio.removeEventListener('pause', handlePause);
      clearInterval(poll1);
      clearInterval(poll2);
    };
  }, [isDJ, emit, onPercentUpdate]);

  useEffect(() => {
    if (!isDJ) return;
    const interval = setInterval(() => {
      if (audioRef.current && playbackRef.current.isPlaying) {
        emit('dj:sync', { position: audioRef.current.currentTime });
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [isDJ, emit]);

  useEffect(() => {
    const handleUpdate = (state) => {
      playbackRef.current = { isPlaying: state.isPlaying, currentTime: state.currentTime };
      setPlaybackState(state);

      // The DJ host owns the audio element. Don't repeatedly call play() from
      // periodic server updates while the browser is still completing a seek.
      if (isDJ) return;
      const audio = audioRef.current;
      if (!audio || !state.track) return;

      const diff = Math.abs(audio.currentTime - state.currentTime);
      const threshold = state.forceResync ? 0.1 : 2;
      if (diff > threshold && audio.readyState >= 2) {
        audio.currentTime = state.currentTime;
      }
      if (state.isPlaying && audio.paused && audio.readyState >= 2) {
        audio.play().catch(() => {});
      } else if (!state.isPlaying && !audio.paused) {
        audio.pause();
      }
    };

    const unsub = on('dj:playbackUpdate', handleUpdate);
    return () => unsub?.();
  }, [on, isDJ]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.muted = !isActive;
      if (isActive && playbackState.isPlaying && audioRef.current.paused) {
        audioRef.current.play().catch(() => {});
      }
    }
  }, [isActive, playbackState.isPlaying]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = isMuted ? 0 : volume;
  }, [isMuted, volume]);

  useEffect(() => {
    const unsub = on('dj:reaction', (data) => {
      setReactions(prev => [...prev, { ...data, receivedAt: Date.now(), posX: 25 + Math.random() * 50 }]);
    });
    return () => unsub?.();
  }, [on]);

  useEffect(() => {
    if (reactions.length === 0) return;
    const timer = setTimeout(() => {
      setReactions(prev => prev.filter(r => Date.now() - r.receivedAt < 900));
    }, 900);
    return () => clearTimeout(timer);
  }, [reactions]);

  useEffect(() => {
    const unsub = on('reactions:enabled', setReactionsEnabled);
    return () => unsub?.();
  }, [on]);

  const handlePlayTrack = useCallback((trackName) => {
    emit('dj:play', { track: trackName }, (res) => {
      if (res?.error) console.error(res.error);
    });
  }, [emit]);

  const handlePause = useCallback(() => {
    if (audioRef.current) audioRef.current.pause();
    emit('dj:pause', {});
  }, [emit]);

  const handleResume = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.play().catch(() => {});
    }
    emit('dj:resume', {});
  }, [emit]);

  const handleSeek = useCallback((time) => {
    if (audioRef.current) audioRef.current.currentTime = time;
    emit('dj:seek', { time });
  }, [emit]);

  const currentTrack = tracks.find(t => t.name === playbackState.track);
  const duration = currentTrack?.duration || 0;

  const handleSeekChange = useCallback((e) => {
    const pct = parseFloat(e.target.value);
    setDragTime(pct);
  }, []);

  const handleSeekStart = useCallback(() => {
    if (seekInProgressRef.current) return;
    seekInProgressRef.current = true;
    // Capture this before changing currentTime: a media seek can fire a pause
    // event, which otherwise makes the release handler think playback was paused.
    wasPlayingBeforeSeekRef.current = !!audioRef.current && !audioRef.current.paused;
    resumeAfterSeekRef.current = false;
    clearTimeout(seekResumeTimeoutRef.current);
    setDragTime(playbackPercent);
    if (wasPlayingBeforeSeekRef.current) {
      audioRef.current.pause();
      playbackRef.current.isPlaying = false;
      emit('dj:pause', {});
    }
  }, [emit, playbackPercent]);

  const handleSeekEnd = useCallback((e) => {
    const pct = parseFloat(e.target.value);
    setDragTime(null);
    if (!seekInProgressRef.current) handleSeekStart();
    seekInProgressRef.current = false;
    if (duration <= 0) return;

    const time = (pct / 100) * duration;
    const audio = audioRef.current;
    resumeAfterSeekRef.current = wasPlayingBeforeSeekRef.current;
    if (audio) {
      audio.currentTime = time;
      playbackRef.current.currentTime = time;
    }
    emit('dj:seek', { time });
    onSeekPercent?.(pct);

    if (wasPlayingBeforeSeekRef.current && audio) {
      playbackRef.current.isPlaying = true;
      // Some browsers report seeking=false before dispatching `seeked`; the
      // timeout is a fallback for that case and is cleared by the event.
      seekResumeTimeoutRef.current = setTimeout(() => {
        if (!resumeAfterSeekRef.current) return;
        resumeAfterSeekRef.current = false;
        playbackRef.current.isPlaying = true;
        emit('dj:resume', {});
        audio.play().catch((error) => console.error('[DJ] Resume after seek failed:', error));
      }, 1000);
    }
    wasPlayingBeforeSeekRef.current = false;
  }, [duration, emit, handleSeekStart, onSeekPercent]);

  const handleReaction = useCallback((emoji) => {
    emit('dj:reaction', { emoji });
  }, [emit]);

  return (
    <div className="dj-room">
      <div className="dj-player">
        <AudioVisualizer audioRef={audioRef} isPlaying={playbackState.isPlaying} />

        {playbackState.track && (
          <div className="dj-now-playing">
            <span className="dj-track-name">{currentTrack?.displayName || playbackState.track}</span>
            <span className="dj-time">
              {formatTime(playbackState.currentTime)} / {formatTime(duration)}
            </span>
          </div>
        )}

        <div className="dj-reactions">
          {reactions.map(r => (
            <div key={r.id} className="dj-reaction-float" style={{ left: `${r.posX}%` }}>
              {r.emoji}
            </div>
          ))}
        </div>

        {isDJ && playbackState.track && (
          <div className="dj-controls">
            {playbackState.isPlaying ? (
              <button onClick={handlePause}>⏸ Pause</button>
            ) : (
              <button onClick={handleResume}>▶ Play</button>
            )}
          </div>
        )}

        {isDJ && playbackState.track && duration > 0 && (
          <div className="dj-seek-bar">
            <input
              type="range"
              min={0}
              max={100}
              step={0.1}
              value={dragTime !== null ? dragTime : Math.min(playbackPercent, 100)}
              onPointerDown={handleSeekStart}
              onKeyDown={handleSeekStart}
              onChange={handleSeekChange}
              onPointerUp={handleSeekEnd}
              onPointerCancel={handleSeekEnd}
              onKeyUp={handleSeekEnd}
            />
            <div className="dj-seek-labels">
              <span>{formatTime((playbackPercent / 100) * duration)}</span>
              <span>{formatTime(duration)}</span>
            </div>
          </div>
        )}

        <div className="dj-volume-control">
          <button className="mute-btn" onClick={() => setIsMuted(m => !m)} title={isMuted ? 'Unmute' : 'Mute'}>
            {isMuted ? '🔇' : volume > 0.5 ? '🔊' : volume > 0 ? '🔉' : '🔈'}
          </button>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={volume}
            onChange={(e) => setVolume(parseFloat(e.target.value))}
            className="volume-slider"
          />
        </div>

        <audio ref={audioRef} preload="auto" playsInline />
      </div>

      <div className="dj-sidebar">
        <div className="dj-sidebar-header">
          <h4>Tracks</h4>
          <button onClick={handleRefreshTracks} title="Refresh track list">↻</button>
        </div>
        <div className="dj-track-list">
          {tracks.length === 0 && <p className="dj-no-tracks">No audio files found</p>}
          {tracks.map((track, index) => (
            <button
              key={track.name}
              className={`dj-track ${playbackState.track === track.name ? 'active' : ''} ${dragIndex === index ? 'dragging' : ''} ${dragOverIndex === index ? 'drag-over' : ''}`}
              onClick={() => isDJ && handlePlayTrack(track.name)}
              draggable={isDJ}
              onDragStart={handleDragStart(index)}
              onDragOver={handleDragOver(index)}
              onDrop={handleDrop(index)}
              onDragEnd={handleDragEnd}
            >
              {isDJ && <span className="dj-drag-handle" title="Drag to reorder">⋮⋮</span>}
              <span className="dj-track-name">{track.displayName}</span>
              {track.duration && <span className="dj-track-duration">{formatTime(track.duration)}</span>}
            </button>
          ))}
        </div>

        {reactionsEnabled && (
          <div className="dj-reaction-bar">
            {['🍾', '💸', '❄️', '🤘'].map(emoji => (
              <button key={emoji} className="dj-reaction-btn" onClick={() => handleReaction(emoji)}>
                {emoji}
              </button>
            ))}
          </div>
        )}
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
