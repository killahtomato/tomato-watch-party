import { useEffect, useRef, useState, useCallback } from 'react';
import AudioVisualizer from './AudioVisualizer.jsx';

export default function DJRoom({ emit, on, sessionData, isDJ, onDJLogin, isActive = true }) {
  const audioRef = useRef(null);
  const playbackRef = useRef({ isPlaying: false, currentTime: 0 });
  const lastSeekTime = useRef(0);
  const [tracks, setTracks] = useState([]);
  const [playbackState, setPlaybackState] = useState({ track: null, isPlaying: false, currentTime: 0 });
  const [reactions, setReactions] = useState([]);
  const [reactionsEnabled, setReactionsEnabled] = useState(true);
  const [trackListOpen, setTrackListOpen] = useState(false);

  const trackUrl = playbackState.track
    ? `/api/audio-file/${encodeURIComponent(playbackState.track)}`
    : null;

  useEffect(() => {
    fetch('/api/audio-files').then(r => r.json()).then(setTracks).catch(() => {});
  }, []);

  const handleRefreshTracks = useCallback(() => {
    fetch('/api/audio-files').then(r => r.json()).then(setTracks).catch(() => {});
  }, []);

  useEffect(() => {
    if (!audioRef.current || !trackUrl) return;

    const onCanPlay = () => {
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
    };
    const handleEnded = () => {
      if (isDJ) emit('dj:ended', {});
    };
    const handlePlay = () => { playbackRef.current.isPlaying = true; };
    const handlePause = () => { playbackRef.current.isPlaying = false; };

    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('play', handlePlay);
    audio.addEventListener('pause', handlePause);

    const poll = setInterval(() => {
      if (audio.duration > 0) {
        playbackRef.current.currentTime = audio.currentTime;
      }
    }, 250);

    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('play', handlePlay);
      audio.removeEventListener('pause', handlePause);
      clearInterval(poll);
    };
  }, [isDJ, emit]);

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

  const handleReaction = useCallback((emoji) => {
    emit('dj:reaction', { emoji });
  }, [emit]);

  const currentTrack = tracks.find(t => t.name === playbackState.track);
  const duration = currentTrack?.duration || 0;

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

        <audio ref={audioRef} preload="auto" playsInline />
      </div>

      <div className="dj-sidebar">
        <div className="dj-sidebar-header">
          <h4>Tracks</h4>
          <button onClick={handleRefreshTracks} title="Refresh track list">↻</button>
        </div>
        <div className="dj-track-list">
          {tracks.length === 0 && <p className="dj-no-tracks">No audio files found</p>}
          {tracks.map(track => (
            <button
              key={track.name}
              className={`dj-track ${playbackState.track === track.name ? 'active' : ''}`}
              onClick={() => isDJ && handlePlayTrack(track.name)}
            >
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
