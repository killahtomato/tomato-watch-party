import { useEffect, useRef, useState, useCallback } from 'react';
import Hls from 'hls.js';
import { parseVtt } from '../utils/subtitles';
import { readSettings, writeSettings } from '../utils/settings.js';

export default function WebRoom({ webState, emit, on, isActive = true, unlocked = false, userId }) {
  const saved = useRef(readSettings()).current;
  const videoRef = useRef(null);
  const containerRef = useRef(null);
  const controlsTimerRef = useRef(null);
  const retryTimerRef = useRef(null);
  const retryCountRef = useRef(0);
  const startedRef = useRef(false);

  const playbackRef = useRef({
    isPlaying: Boolean(webState?.isPlaying),
    currentTime: webState?.currentTime || 0,
  });

  const [volume, setVolume] = useState(saved.movieVolume ?? 1);
  const [isMuted, setIsMuted] = useState(saved.movieMuted ?? false);
  const [progress, setProgress] = useState(0);
  const [loading, setLoading] = useState(false);
  const [videoError, setVideoError] = useState(false);
  const [videoEnded, setVideoEnded] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [throws, setThrows] = useState([]);
  const [splattering, setSplattering] = useState({});
  const [reactions, setReactions] = useState([]);
  const [subEntries, setSubEntries] = useState([]);
  const [currentSubText, setCurrentSubText] = useState('');

  const unlockedRef = useRef(unlocked);
  unlockedRef.current = unlocked;
  const activeRef = useRef(isActive);
  activeRef.current = isActive;

  const stream = webState?.web || null;
  const proxyUrl = stream?.proxyUrl || null;
  const isHls = (stream?.type || 'hls') === 'hls';
  const useHlsJs = isHls && Hls.isSupported();
  const myUserId = userId || null;

  useEffect(() => {
    playbackRef.current = {
      isPlaying: Boolean(webState?.isPlaying),
      currentTime: webState?.currentTime || 0,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    writeSettings({ movieVolume: volume, movieMuted: isMuted });
  }, [volume, isMuted]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !proxyUrl) return undefined;

    setLoading(true);
    setVideoError(false);
    startedRef.current = false;
    retryCountRef.current = 0;
    let hls = null;

    const startPlayback = () => {
      if (startedRef.current) return;
      if (video.readyState >= 2 && Math.abs(video.currentTime - playbackRef.current.currentTime) > 1) {
        video.currentTime = playbackRef.current.currentTime;
      }
      startedRef.current = true;
      if (playbackRef.current.isPlaying && unlockedRef.current && activeRef.current) {
        video.play().catch(() => {});
      }
    };

    if (useHlsJs) {
      hls = new Hls({ enableWorker: true });
      hls.loadSource(proxyUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal) return;
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          setVideoError(true);
          hls.startLoad();
        } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          hls.recoverMediaError();
        } else {
          setVideoError(true);
          hls.destroy();
        }
      });
      hls.on(Hls.Events.MANIFEST_PARSED, startPlayback);
    }

    const handleCanPlay = () => startPlayback();
    video.addEventListener('canplay', handleCanPlay);

    return () => {
      video.removeEventListener('canplay', handleCanPlay);
      if (hls) hls.destroy();
    };
  }, [proxyUrl, useHlsJs]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (!isActive) {
      video.pause();
    } else if (playbackRef.current.isPlaying && unlockedRef.current) {
      video.play().catch(() => {});
    }
  }, [isActive, unlocked]);

  useEffect(() => {
    if (!on) return undefined;

    const handleUpdate = (state) => {
      playbackRef.current = { isPlaying: state.isPlaying, currentTime: state.currentTime };
      if (state.isPlaying) setVideoError(false);

      const video = videoRef.current;
      if (!video || !proxyUrl || !activeRef.current) return;

      const diff = Math.abs(video.currentTime - state.currentTime);
      const threshold = state.forceResync ? 0.1 : 4;
      if (diff > threshold && video.readyState >= 2) {
        video.currentTime = state.currentTime;
      }
      if (state.isPlaying && video.paused && unlockedRef.current && video.readyState >= 2) {
        video.play().catch(() => {});
      } else if (!state.isPlaying && !video.paused) {
        video.pause();
      }
    };

    const unsubUpdate = on('web:playbackUpdate', handleUpdate);
    const unsubThrow = on('throw', (data) => {
      setThrows(prev => [...prev, { ...data, thrownAt: Date.now() }]);
      setTimeout(() => {
        setSplattering(prev => ({ ...prev, [data.id]: true }));
      }, 1100);
      setTimeout(() => {
        setThrows(prev => prev.filter(t => t.id !== data.id));
        setSplattering(prev => {
          const next = { ...prev };
          delete next[data.id];
          return next;
        });
      }, 1600);
    });
    const unsubReaction = on('reaction', (data) => {
      setReactions(prev => [...prev, { ...data, receivedAt: Date.now(), posX: 25 + Math.random() * 50 }]);
      setTimeout(() => {
        setReactions(prev => prev.filter(r => r.id !== data.id));
      }, 900);
    });

    return () => {
      unsubUpdate?.();
      unsubThrow?.();
      unsubReaction?.();
    };
  }, [on, proxyUrl]);

  useEffect(() => {
    const subs = stream?.subtitles || [];
    const subtitleUrl = subs[0]?.proxyUrl;
    if (!subtitleUrl) {
      setSubEntries([]);
      setCurrentSubText('');
      return undefined;
    }
    let cancelled = false;
    fetch(subtitleUrl)
      .then(response => response.text())
      .then(text => { if (!cancelled) setSubEntries(parseVtt(text)); })
      .catch(() => { if (!cancelled) setSubEntries([]); });
    return () => { cancelled = true; };
  }, [stream?.subtitles, proxyUrl]);

  useEffect(() => {
    if (subEntries.length === 0) {
      setCurrentSubText('');
      return undefined;
    }
    const interval = setInterval(() => {
      const video = videoRef.current;
      if (!video) return;
      const t = video.currentTime;
      const entry = subEntries.find(e => t >= e.start && t <= e.end);
      setCurrentSubText(entry ? entry.text : '');
    }, 100);
    return () => clearInterval(interval);
  }, [subEntries]);

  useEffect(() => {
    const video = videoRef.current;
    if (video) {
      video.volume = volume;
      video.muted = isMuted || !isActive;
    }
  }, [isMuted, isActive, volume]);

  useEffect(() => () => {
    clearTimeout(controlsTimerRef.current);
    clearTimeout(retryTimerRef.current);
  }, []);

  const showControlsTemporarily = useCallback(() => {
    setControlsVisible(true);
    clearTimeout(controlsTimerRef.current);
    controlsTimerRef.current = setTimeout(() => {
      if (playbackRef.current.isPlaying) setControlsVisible(false);
    }, 3000);
  }, []);

  const handleVideoTap = useCallback(() => {
    if (controlsVisible) setControlsVisible(false);
    else showControlsTemporarily();
  }, [controlsVisible, showControlsTemporarily]);

  const handleLoadedData = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    const state = playbackRef.current;
    if (state.currentTime > 0 && Math.abs(video.currentTime - state.currentTime) > 1) {
      video.currentTime = state.currentTime;
    }
    if (activeRef.current && state.isPlaying && unlockedRef.current && video.paused) {
      video.play().catch(() => {});
    }
  }, []);

  const handleTimeUpdate = useCallback(() => {
    const video = videoRef.current;
    if (!video || !Number.isFinite(video.duration) || video.duration <= 0) {
      setProgress(0);
      return;
    }
    setProgress(Math.min(100, (video.currentTime / video.duration) * 100));
  }, []);

  const handleVideoError = useCallback(() => {
    if (!activeRef.current) return;
    if (useHlsJs || retryCountRef.current >= 2) {
      setLoading(false);
      setVideoError(true);
      return;
    }
    setVideoError(true);
    retryCountRef.current += 1;
    clearTimeout(retryTimerRef.current);
    retryTimerRef.current = setTimeout(() => {
      const video = videoRef.current;
      if (activeRef.current && video && proxyUrl) {
        video.load();
        if (playbackRef.current.isPlaying && unlockedRef.current) video.play().catch(() => {});
      }
    }, 2000 * retryCountRef.current);
  }, [useHlsJs, proxyUrl]);

  const handleCanPlay = useCallback(() => {
    setLoading(false);
    setVideoError(false);
    clearTimeout(retryTimerRef.current);
  }, []);

  const toggleFullscreen = useCallback(() => {
    const video = videoRef.current;
    const container = containerRef.current;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
      return;
    }
    if (video?.webkitEnterFullscreen) {
      video.webkitEnterFullscreen();
    } else if (container?.requestFullscreen) {
      container.requestFullscreen().catch(() => {});
    } else if (video?.requestFullscreen) {
      video.requestFullscreen().catch(() => {});
    }
  }, []);

  const showControls = controlsVisible || !playbackRef.current.isPlaying || videoEnded;

  return (
    <div className="m-movie-room" ref={containerRef}>
      <video
        ref={videoRef}
        className="m-video"
        key={proxyUrl || 'no-stream'}
        src={useHlsJs ? undefined : proxyUrl}
        playsInline
        preload="auto"
        disablePictureInPicture
        onClick={handleVideoTap}
        onLoadedData={handleLoadedData}
        onLoadStart={() => setLoading(true)}
        onCanPlay={handleCanPlay}
        onWaiting={() => setLoading(true)}
        onPlaying={() => setLoading(false)}
        onTimeUpdate={handleTimeUpdate}
        onError={handleVideoError}
        onEnded={() => setVideoEnded(true)}
      />

      <div className="m-progress-bar">
        <div className="m-progress-fill" style={{ width: `${progress}%` }} />
      </div>

      <div className="m-movie-info">
        <span className="m-movie-title">{stream?.title || 'Web stream'}</span>
      </div>

      {loading && !videoEnded && (
        <div className="m-loading">
          <div className="m-spinner" />
          <p>Loading...</p>
        </div>
      )}

      {videoEnded && (
        <div className="m-end-overlay">
          <div className="m-end-box">
            <span className="m-end-icon">🎬</span>
            <h2>The End</h2>
            <p>Thank you for watching! :3</p>
          </div>
        </div>
      )}

      {videoError && !videoEnded && (
        <div className="m-error-overlay">
          <p>Connection lost. Retrying...</p>
        </div>
      )}

      {currentSubText && (
        <div className="m-subtitle">
          <span>{currentSubText}</span>
        </div>
      )}

      <div className="throw-overlay">
        {throws.map(t => {
          const isThrower = t.throwerId === myUserId;
          const isSplatter = splattering[t.id];
          const animClass = isThrower ? 'throw-firstperson' : t.throwerSide === 'left' ? 'throw-from-left' : 'throw-from-right';
          const style = isThrower
            ? { '--throw-x': `${46 + Math.random() * 8}%`, '--throw-y': `${55 + Math.random() * 25}%` }
            : {
              '--throw-start-y': `${5 + Math.random() * 20}%`,
              '--throw-end-x': t.throwerSide === 'left' ? `${40 + Math.random() * 15}%` : `${45 + Math.random() * 15}%`,
              '--throw-end-y': `${30 + Math.random() * 30}%`,
            };
          return (
            <div key={t.id} className={`throw-item ${animClass} ${isSplatter ? 'splatter' : ''}`} style={style}>
              {isSplatter ? (t.item === 'tomato' ? '🔴' : '💛') : (t.item === 'tomato' ? '🍅' : '🍿')}
              {!isSplatter && <span className="throw-name">{t.name}</span>}
            </div>
          );
        })}
        {reactions.map(r => (
          <div key={r.id} className="reaction-float" style={{ left: `${r.posX}%` }}>
            {r.emoji}
            <span className="reaction-name">{r.name}</span>
          </div>
        ))}
      </div>

      <div className={`m-movie-controls ${showControls ? 'visible' : 'hidden'}`}>
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
          <button className="m-icon-btn" onClick={toggleFullscreen} title="Fullscreen">⛶</button>
        </div>
      </div>
    </div>
  );
}
