import { useEffect, useRef, useState, useCallback } from 'react';
import Hls from 'hls.js';
import ThrowButton from './ThrowButton.jsx';

export default function WebPlayer({
  userId,
  isHost,
  emit,
  on,
  webState,
  seekRef,
  playRef,
  pauseRef,
  isActive = true,
  onProgress,
}) {
  const videoRef = useRef(null);
  const playbackRef = useRef({ isPlaying: false, currentTime: 0 });
  const lastSeekTime = useRef(0);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [throws, setThrows] = useState([]);
  const [splattering, setSplattering] = useState({});
  const [reactions, setReactions] = useState([]);
  const [reactionsEnabled, setReactionsEnabled] = useState(true);
  const [videoError, setVideoError] = useState(false);
  const [videoEnded, setVideoEnded] = useState(false);
  const [bufferHealth, setBufferHealth] = useState(0);
  const [pingMs, setPingMs] = useState(0);

  const stream = webState?.web || null;
  const proxyUrl = stream?.proxyUrl || null;
  const mediaType = stream?.type || 'hls';
  const isHls = mediaType === 'hls';
  const myUserId = userId || null;

  const handleThrow = useCallback((item) => {
    emit('throw', { item });
  }, [emit]);

  const handleReaction = useCallback((emoji) => {
    emit('reaction', { emoji });
  }, [emit]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !proxyUrl) return;

    let hls = null;
    const startPlayback = () => {
      if (playbackRef.current.isPlaying) video.play().catch(() => {});
    };

    if (isHls && Hls.isSupported()) {
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

    const onCanPlay = () => startPlayback();
    video.addEventListener('canplay', onCanPlay);
    startPlayback();

    return () => {
      video.removeEventListener('canplay', onCanPlay);
      if (hls) hls.destroy();
    };
  }, [proxyUrl, isHls]);

  useEffect(() => {
    if (!isHost) return;
    const interval = setInterval(() => {
      const video = videoRef.current;
      if (video && playbackRef.current.isPlaying) {
        emit('web:sync', { position: video.currentTime });
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [isHost, emit]);

  useEffect(() => {
    if (!on) return;

    const handlePlaybackUpdate = (state) => {
      playbackRef.current = { isPlaying: state.isPlaying, currentTime: state.currentTime };
      if (state.isPlaying && videoError) setVideoError(false);

      const video = videoRef.current;
      if (!video || !proxyUrl) return;

      if (isHost) {
        if (state.isPlaying && video.paused) video.play().catch(() => {});
        return;
      }

      const diff = Math.abs(video.currentTime - state.currentTime);
      const threshold = state.forceResync ? 0.1 : 4;
      if (diff > threshold && video.readyState >= 2) {
        lastSeekTime.current = Date.now();
        video.currentTime = state.currentTime;
      }
      if (state.isPlaying && video.paused && video.readyState >= 2) {
        video.play().catch(() => {});
      } else if (!state.isPlaying && !video.paused) {
        video.pause();
      }
    };

    const unsubUpdate = on('web:playbackUpdate', handlePlaybackUpdate);
    const unsubThrow = on('throw', (data) => {
      setThrows((prev) => [...prev, { ...data, thrownAt: Date.now() }]);
    });
    const unsubReaction = on('reaction', (data) => {
      setReactions((prev) => [...prev, { ...data, receivedAt: Date.now(), posX: 25 + Math.random() * 50 }]);
    });
    const unsubReactions = on('reactions:enabled', (enabled) => setReactionsEnabled(enabled));
    return () => {
      unsubUpdate?.();
      unsubThrow?.();
      unsubReaction?.();
      unsubReactions?.();
    };
  }, [on, isHost, proxyUrl, videoError]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleTimeUpdate = () => {
      if (onProgress && video.duration && Number.isFinite(video.duration)) {
        onProgress({ current: video.currentTime, duration: video.duration, live: false });
      } else if (onProgress) {
        onProgress({ current: video.currentTime, duration: 0, live: true });
      }
    };
    const handleSeeked = () => { lastSeekTime.current = Date.now(); };
    const handleEnded = () => {
      setVideoEnded(true);
      if (isHost) emit('web:ended');
    };
    const handleError = () => {
      setVideoError(true);
      if (isHost && !isHls) {
        setTimeout(() => {
          const v = videoRef.current;
          if (v) {
            v.load();
            if (playbackRef.current.isPlaying) v.play().catch(() => {});
          }
        }, 1500);
      }
    };

    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('seeked', handleSeeked);
    video.addEventListener('ended', handleEnded);
    video.addEventListener('error', handleError);
    return () => {
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('seeked', handleSeeked);
      video.removeEventListener('ended', handleEnded);
      video.removeEventListener('error', handleError);
    };
  }, [onProgress, isHost, emit, isHls]);

  useEffect(() => {
    const interval = setInterval(() => {
      const video = videoRef.current;
      if (!video || !playbackRef.current.isPlaying) {
        setBufferHealth(0);
        return;
      }
      const buffered = video.buffered;
      let bufferEnd = 0;
      for (let i = 0; i < buffered.length; i++) {
        if (buffered.start(i) <= video.currentTime) bufferEnd = Math.max(bufferEnd, buffered.end(i));
      }
      const health = bufferEnd - video.currentTime;
      setBufferHealth(health);
      if (!isHost && stream) {
        emit('viewer:health', {
          bufferHealth: health,
          drift: Math.abs(playbackRef.current.currentTime - video.currentTime),
          pingMs,
        });
      }
    }, 500);
    return () => clearInterval(interval);
  }, [isHost, emit, pingMs, stream]);

  useEffect(() => {
    const interval = setInterval(() => {
      const start = Date.now();
      emit('ping:measure', { timestamp: start }, (response) => {
        if (response?.timestamp === start) setPingMs(Date.now() - start);
      });
    }, 5000);
    return () => clearInterval(interval);
  }, [emit]);

  useEffect(() => {
    if (seekRef) seekRef.current = (time) => {
      if (videoRef.current) {
        lastSeekTime.current = Date.now();
        videoRef.current.currentTime = time;
      }
    };
    if (playRef) playRef.current = () => videoRef.current?.play().catch(() => {});
    if (pauseRef) pauseRef.current = () => videoRef.current?.pause();
  }, [seekRef, playRef, pauseRef]);

  useEffect(() => {
    const video = videoRef.current;
    if (video) video.volume = isMuted ? 0 : volume;
  }, [isMuted, volume]);

  useEffect(() => {
    const video = videoRef.current;
    if (video) video.muted = !isActive || isMuted;
  }, [isActive, isMuted]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.volume = 0;
  }, [proxyUrl]);

  useEffect(() => {
    const timers = {};
    throws.forEach((t) => {
      if (!splattering[t.id]) {
        timers[t.id] = setTimeout(() => setSplattering((prev) => ({ ...prev, [t.id]: true })), 1300);
      }
    });
    return () => Object.values(timers).forEach(clearTimeout);
  }, [throws]);

  useEffect(() => {
    const ids = Object.keys(splattering);
    if (ids.length > 0) {
      const timer = setTimeout(() => {
        setThrows((prev) => prev.filter((t) => !ids.includes(t.id)));
        setSplattering((prev) => {
          const next = { ...prev };
          ids.forEach((id) => delete next[id]);
          return next;
        });
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [splattering]);

  useEffect(() => {
    if (reactions.length === 0) return;
    const timer = setTimeout(() => {
      setReactions((prev) => prev.filter((r) => Date.now() - r.receivedAt < 900));
    }, 900);
    return () => clearTimeout(timer);
  }, [reactions]);

  if (!stream) {
    return (
      <div className="video-player empty">
        <div className="waiting-message">
          <h2>Waiting for the show to start...</h2>
          <p>The host will begin streaming shortly.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="video-player">
      {videoEnded && (
        <div className="movie-ended-overlay">
          <div className="movie-ended-content">
            <span className="movie-ended-icon">🎬</span>
            <h2>The End</h2>
            <p>Thank you for watching! :3</p>
          </div>
        </div>
      )}

      {videoError && !videoEnded && (
        <div className="video-error-overlay">
          <div className="video-error-content">
            <p>Stream error. Retrying...</p>
          </div>
        </div>
      )}

      <div className="throw-overlay">
        {throws.map((t) => {
          const isSplatter = splattering[t.id];
          const animClass = t.throwerId === myUserId
            ? 'throw-firstperson'
            : t.throwerSide === 'left' ? 'throw-from-left' : 'throw-from-right';
          const style = t.throwerId === myUserId
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
        {reactions.map((r) => (
          <div key={r.id} className="reaction-float" style={{ left: `${r.posX}%` }}>
            {r.emoji}
            <span className="reaction-name">{r.name}</span>
          </div>
        ))}
      </div>

      <style>{`
        video::-webkit-media-controls { display: none !important; }
        video::-webkit-media-controls-enclosure { display: none !important; }
        video::media-controls { display: none !important; }
      `}</style>
      <video
        ref={videoRef}
        src={isHls ? undefined : proxyUrl}
        playsInline
        controls={false}
        disablePictureInPicture
        onDoubleClick={() => {
          if (document.fullscreenElement) document.exitFullscreen();
          else videoRef.current?.requestFullscreen();
        }}
      />
      <div className="player-controls-right">
        <div className="volume-control">
          <button className="mute-btn" onClick={() => setIsMuted((m) => !m)} title={isMuted ? 'Unmute' : 'Mute'}>
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
      </div>
      <ThrowButton onThrow={handleThrow} onReaction={handleReaction} on={on} reactionsEnabled={reactionsEnabled} />
    </div>
  );
}
