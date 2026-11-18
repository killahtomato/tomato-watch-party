import { useEffect, useRef, useState, useCallback } from 'react';
import AudioVisualizer from '@client/components/AudioVisualizer.jsx';
import { applyOrder } from '@client/utils/order.js';
import { readSettings, writeSettings } from '../utils/settings.js';
import DJTrackList from './DJTrackList.jsx';

function formatTime(seconds) {
  if (!isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function DJRoom({ emit, on, sessionData, userName, unlocked, isActive = true }) {
  const saved = useRef(readSettings()).current;
  const audioRef = useRef(null);
  const [playbackState, setPlaybackState] = useState(
    sessionData?.playbackState || { track: null, isPlaying: false, currentTime: 0 }
  );
  const [tracks, setTracks] = useState([]);
  const [volume, setVolume] = useState(saved.djVolume ?? 1);
  const [isMuted, setIsMuted] = useState(saved.djMuted ?? false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [trackListOpen, setTrackListOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [reactions, setReactions] = useState([]);

  const playbackRef = useRef(playbackState);
  playbackRef.current = playbackState;
  const unlockedRef = useRef(unlocked);
  unlockedRef.current = unlocked;
  const activeRef = useRef(isActive);
  activeRef.current = isActive;

  useEffect(() => {
    writeSettings({ djVolume: volume, djMuted: isMuted });
  }, [volume, isMuted]);

  useEffect(() => {
    if (isActive && sessionData?.playbackState) {
      setPlaybackState(sessionData.playbackState);
    }
  }, [isActive, sessionData?.playbackState]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!isActive) {
      audio.pause();
    } else if (playbackRef.current.isPlaying && unlockedRef.current) {
      audio.play().catch(() => {});
    }
  }, [isActive, unlocked]);

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

  useEffect(() => {
    const handleUpdate = (state) => {
      setPlaybackState(state);
      const audio = audioRef.current;
      if (!audio || !activeRef.current || !state.track) return;
      if (state.track !== playbackRef.current.track) return;
      const diff = Math.abs(audio.currentTime - state.currentTime);
      if (diff > 2 && audio.readyState >= 2) {
        audio.currentTime = state.currentTime;
      }
      if (state.isPlaying && audio.paused && unlockedRef.current) {
        audio.play().catch(() => {});
      } else if (!state.isPlaying && !audio.paused) {
        audio.pause();
      }
    };
    const unsub = on('dj:playbackUpdate', handleUpdate);
    return () => unsub?.();
  }, [on]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = isMuted ? 0 : volume;
  }, [isMuted, volume]);

  const handleLoadedMetadata = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    setDuration(audio.duration || 0);
    const state = playbackRef.current;
    if (state.track && state.currentTime > 0 && Math.abs(audio.currentTime - state.currentTime) > 1) {
      audio.currentTime = state.currentTime;
    }
  }, []);

  const handleCanPlay = useCallback(() => {
    setLoading(false);
    const audio = audioRef.current;
    if (!audio) return;
    const state = playbackRef.current;
    if (activeRef.current && state.isPlaying && unlockedRef.current && audio.paused) {
      audio.play().catch(() => {});
    }
  }, []);

  const handleTimeUpdate = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !audio.duration) return;
    setProgress(Math.min(100, (audio.currentTime / audio.duration) * 100));
  }, []);

  useEffect(() => {
    const unsub = on('dj:reaction', (data) => {
      setReactions(prev => [...prev, { ...data, receivedAt: Date.now(), posX: 25 + Math.random() * 50 }]);
      setTimeout(() => {
        setReactions(prev => prev.filter(r => r.id !== data.id));
      }, 900);
    });
    return () => unsub?.();
  }, [on]);

  const currentTrack = tracks.find(t => t.name === playbackState.track);

  return (
    <div className="m-dj-room">
      <AudioVisualizer audioRef={audioRef} isPlaying={isActive && playbackState.isPlaying} unlocked={unlocked} />

      <div className="dj-reactions">
        {reactions.map(r => (
          <div key={r.id} className="dj-reaction-float" style={{ left: `${r.posX}%` }}>
            {r.emoji}
          </div>
        ))}
      </div>

      {loading && (
        <div className="m-loading">
          <div className="m-spinner" />
          <p>Loading...</p>
        </div>
      )}

      <div className="m-dj-info">
        <span className="m-dj-title">{currentTrack?.displayName || playbackState.track || 'Nothing playing'}</span>
        <span className="m-dj-time">
          {formatTime(playbackState.currentTime)} / {formatTime(duration)}
        </span>
      </div>

      <div className="m-dj-controls">
        <div className="m-progress-bar">
          <div className="m-progress-fill" style={{ width: `${progress}%` }} />
        </div>
        <div className="m-controls-row">
          <button className="m-icon-btn" onClick={() => setIsMuted(m => !m)} title={isMuted ? 'Unmute' : 'Mute'}>
            {isMuted ? '🔇' : volume > 0.5 ? '🔊' : volume > 0 ? '🔉' : '🔈'}
          </button>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={volume}
            onChange={e => setVolume(parseFloat(e.target.value))}
            className="m-volume-slider"
          />
          <button className="m-icon-btn" onClick={() => setTrackListOpen(true)} title="Track list">
            ☰
          </button>
        </div>
      </div>

      {trackListOpen && (
        <DJTrackList
          tracks={tracks}
          currentTrack={playbackState.track}
          onClose={() => setTrackListOpen(false)}
        />
      )}

      <audio
        ref={audioRef}
        src={trackUrl}
        preload="auto"
        onLoadStart={() => setLoading(true)}
        onLoadedMetadata={handleLoadedMetadata}
        onCanPlay={handleCanPlay}
        onWaiting={() => setLoading(true)}
        onPlaying={() => setLoading(false)}
        onTimeUpdate={handleTimeUpdate}
      />
    </div>
  );
}
