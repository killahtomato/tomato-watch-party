import { useEffect, useRef, useState, useCallback } from 'react';
import AudioVisualizer from './AudioVisualizer.jsx';
import { applyOrder } from '../utils/order.js';
import { useSettings } from '../hooks/useSettings.js';
import { updateSettings } from '../utils/settings.js';
import { TRACK_SORTS, filterTracks, sortTracks, groupTracksByAlbum, computeNextTrack } from '../utils/trackList.js';

export default function DJRoom({ emit, on, sessionData, isDJ, onDJLogin, isActive = true, seekRef, playRef, pauseRef, onSeekPercent, onPercentUpdate, playbackPercent = 0 }) {
  const audioRef = useRef(null);
  const preloadRef = useRef(null);
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
  const settings = useSettings();

  useEffect(() => { setVolume(settings.volume); }, [settings.volume]);

  const handleVolumeChange = useCallback((value) => {
    setVolume(value);
    updateSettings({ volume: value });
  }, []);
  const [dragIndex, setDragIndex] = useState(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);
  const [query, setQuery] = useState('');
  const [sortBy, setSortBy] = useState('name');
  const [groupByAlbum, setGroupByAlbum] = useState(false);

  const tracksRef = useRef(tracks);
  tracksRef.current = tracks;
  const currentTrackRef = useRef(playbackState.track);
  currentTrackRef.current = playbackState.track;
  const modeRef = useRef({ shuffle: false, repeat: 'all' });
  modeRef.current = { shuffle: playbackState.shuffle, repeat: playbackState.repeat };

  const isPlainList = !query.trim() && sortBy === 'name' && !groupByAlbum;
  const visibleTracks = isPlainList ? tracks : sortTracks(filterTracks(tracks, query), sortBy);
  const trackGroups = groupByAlbum ? groupTracksByAlbum(visibleTracks) : null;

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
    if (!isDJ || !isPlainList) return;
    setDragIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(index));
  }, [isDJ, isPlainList]);

  const handleDragOver = useCallback((index) => (e) => {
    if (!isDJ || !isPlainList) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverIndex(index);
  }, [isDJ, isPlainList]);

  const handleDrop = useCallback((index) => (e) => {
    if (!isDJ || !isPlainList) return;
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
  }, [dragIndex, tracks, emit, isDJ, isPlainList]);

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
    const { shuffle, repeat } = modeRef.current;
    const nextTrack = computeNextTrack(tracksRef.current, currentTrackRef.current, shuffle, repeat);
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
    const applyVolume = () => {
      const audio = audioRef.current;
      if (!audio) return;
      let factor = 1;
      if (settings.djCrossfade && !settings.reduceMotion && playbackState.isPlaying && audio.duration > 0) {
        const t = audio.currentTime;
        if (t < 1.2) factor = Math.max(0, t / 1.2);
        else if (t > audio.duration - 1.5) factor = Math.max(0, (audio.duration - t) / 1.5);
      }
      audio.volume = (isMuted ? 0 : volume) * factor;
    };
    applyVolume();
    const interval = setInterval(applyVolume, 100);
    return () => clearInterval(interval);
  }, [isMuted, volume, playbackState.isPlaying, playbackState.track, settings.djCrossfade, settings.reduceMotion]);

  useEffect(() => {
    const next = computeNextTrack(tracks, playbackState.track, playbackState.shuffle, playbackState.repeat);
    if (next && preloadRef.current) {
      preloadRef.current.src = `/api/audio-file/${encodeURIComponent(next.name)}`;
    }
  }, [tracks, playbackState.track, playbackState.shuffle, playbackState.repeat]);

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

  const handleToggleShuffle = useCallback(() => {
    emit('dj:setShuffle', { value: !playbackState.shuffle }, (res) => {
      if (res?.error) console.error(res.error);
    });
  }, [emit, playbackState.shuffle]);

  const handleCycleRepeat = useCallback(() => {
    const modes = ['off', 'all', 'one'];
    const next = modes[(modes.indexOf(playbackState.repeat) + 1) % modes.length];
    emit('dj:setRepeat', { value: next }, (res) => {
      if (res?.error) console.error(res.error);
    });
  }, [emit, playbackState.repeat]);

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

  const renderTrack = (track, index) => (
    <button
      key={track.name}
      className={`dj-track ${playbackState.track === track.name ? 'active' : ''} ${dragIndex === index ? 'dragging' : ''} ${dragOverIndex === index ? 'drag-over' : ''}`}
      onClick={() => isDJ && handlePlayTrack(track.name)}
      draggable={isDJ && isPlainList}
      onDragStart={handleDragStart(index)}
      onDragOver={handleDragOver(index)}
      onDrop={handleDrop(index)}
      onDragEnd={handleDragEnd}
    >
      {isDJ && isPlainList && <span className="dj-drag-handle" title="Drag to reorder">⋮⋮</span>}
      {track.hasArt && (
        <img
          className="dj-track-art"
          src={`/api/audio-art/${encodeURIComponent(track.name)}`}
          alt=""
          loading="lazy"
        />
      )}
      <span className="dj-track-text">
        <span className="dj-track-name">{track.title || track.displayName}</span>
        {track.artist && <span className="dj-track-artist">{track.artist}</span>}
      </span>
      {track.duration
        ? <span className="dj-track-duration">{formatTime(track.duration)}</span>
        : <span />}
    </button>
  );

  return (
    <div className="dj-room">
      <div className="dj-player">
        <AudioVisualizer audioRef={audioRef} isPlaying={playbackState.isPlaying} variant={settings.djVisualizer} />

        {playbackState.track && currentTrack && (
          <div className="dj-now-playing">
            {currentTrack.hasArt && (
              <img
                className="dj-cover"
                src={`/api/audio-art/${encodeURIComponent(currentTrack.name)}`}
                alt=""
                loading="lazy"
              />
            )}
            <div className="dj-now-meta">
              <span className="dj-track-name">{currentTrack.title || currentTrack.displayName}</span>
              {(currentTrack.artist || currentTrack.album) && (
                <span className="dj-track-sub">
                  {[currentTrack.artist, currentTrack.album].filter(Boolean).join(' — ')}
                  {currentTrack.year ? ` · ${currentTrack.year}` : ''}
                </span>
              )}
              <span className="dj-time">
                {formatTime(playbackState.currentTime)} / {formatTime(duration)}
              </span>
            </div>
          </div>
        )}

        {!settings.reduceMotion && (
          <div className="dj-reactions">
            {reactions.map(r => (
              <div key={r.id} className="dj-reaction-float" style={{ left: `${r.posX}%` }}>
                {r.emoji}
              </div>
            ))}
          </div>
        )}

        {isDJ && playbackState.track && (
          <div className="dj-controls">
            <button
              className={`dj-mode-btn ${playbackState.shuffle ? 'active' : ''}`}
              onClick={handleToggleShuffle}
              aria-pressed={playbackState.shuffle}
              title={playbackState.shuffle ? 'Shuffle on' : 'Shuffle off'}
            >
              <span className="dj-mode-icon">🔀</span>
              <span className="dj-mode-text">Shuffle</span>
            </button>
            <button
              className={`dj-mode-btn ${playbackState.repeat !== 'off' ? 'active' : ''}`}
              onClick={handleCycleRepeat}
              aria-pressed={playbackState.repeat !== 'off'}
              title={`Repeat: ${playbackState.repeat}`}
            >
              <span className="dj-mode-icon">{playbackState.repeat === 'one' ? '🔂' : '🔁'}</span>
              <span className="dj-mode-text">
                {playbackState.repeat === 'one' ? 'Repeat 1' : playbackState.repeat === 'all' ? 'Repeat All' : 'Repeat Off'}
              </span>
            </button>
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
            onChange={(e) => handleVolumeChange(parseFloat(e.target.value))}
            className="volume-slider"
          />
        </div>

        <audio ref={audioRef} preload="auto" playsInline />
        <audio ref={preloadRef} preload="auto" style={{ display: 'none' }} />
      </div>

      <div className="dj-sidebar">
        <div className="dj-sidebar-header">
          <h4>Tracks ({tracks.length})</h4>
          <button onClick={handleRefreshTracks} title="Refresh track list">↻</button>
        </div>
        <div className="dj-track-controls">
          <input
            type="search"
            className="dj-search"
            placeholder="Search tracks…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="dj-track-controls-row">
            <select
              className="dj-sort"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              title="Sort tracks"
            >
              {TRACK_SORTS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <label className="dj-group">
              <input
                type="checkbox"
                checked={groupByAlbum}
                onChange={(e) => setGroupByAlbum(e.target.checked)}
              />
              <span>Group by album</span>
            </label>
          </div>
        </div>
        <div className="dj-track-list">
          {tracks.length === 0 && <p className="dj-no-tracks">No audio files found</p>}
          {tracks.length > 0 && visibleTracks.length === 0 && <p className="dj-no-tracks">No matching tracks</p>}
          {trackGroups
            ? trackGroups.map(group => (
              <div key={group.album} className="dj-track-group">
                <div className="dj-track-group-header">{group.album}</div>
                {group.tracks.map(track => renderTrack(track, tracks.indexOf(track)))}
              </div>
            ))
            : visibleTracks.map((track, index) => renderTrack(track, index))}
        </div>

        {reactionsEnabled && !settings.reduceMotion && (
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
