import { useEffect, useRef, useState, useCallback } from 'react';
import Hls from 'hls.js';
import ThrowButton from './ThrowButton.jsx';

export default function VideoPlayer({ userName, isHost, emit, on, sessionData }) {
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const playbackRef = useRef({ isPlaying: false, currentTime: 0 });
  const [playbackState, setPlaybackState] = useState(
    sessionData?.playbackState || { movie: null, isPlaying: false, currentTime: 0 }
  );
  const [throws, setThrows] = useState([]);
  const [hlsError, setHlsError] = useState(null);
  const [isMuted, setIsMuted] = useState(true);

  const initHls = useCallback(() => {
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    setHlsError(null);

    if (!videoRef.current) return;

    const video = videoRef.current;
    video.muted = true;
    const hlsUrl = `/hls/index.m3u8`;

    if (Hls.isSupported()) {
      const hls = new Hls({
        liveSyncDurationCount: 3,
        lowLatencyMode: true,
        backBufferLength: 90,
      });
      hls.loadSource(hlsUrl);
      hls.attachMedia(video);

      const attemptPlay = () => {
        if (!playbackRef.current.isPlaying) return;
        video.play().catch(() => {
          video.muted = true;
          video.play().catch(() => {});
        });
      };

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (playbackRef.current.currentTime > 0) {
          video.currentTime = playbackRef.current.currentTime;
        }
        if (playbackRef.current.isPlaying) {
          if (video.readyState >= 2) {
            attemptPlay();
          } else {
            video.oncanplay = attemptPlay;
          }
        }
      });

      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) {
          setHlsError(`${data.details} (${data.type})`);
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              hls.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              hls.recoverMediaError();
              break;
            default:
              hls.destroy();
              break;
          }
        }
      });

      hlsRef.current = hls;
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = hlsUrl;
      video.oncanplay = () => {
        if (playbackRef.current.isPlaying) {
          video.play().catch(() => {});
        }
      };
    }
  }, []);

  useEffect(() => {
    const handlePlaybackUpdate = (state) => {
      playbackRef.current = { isPlaying: state.isPlaying, currentTime: state.currentTime };
      setPlaybackState(state);

      if (!hlsRef.current) {
        if (state.isPlaying) {
          initHls();
        }
        return;
      }

      if (videoRef.current && !hlsError) {
        const targetTime = state.currentTime;
        const diff = Math.abs(videoRef.current.currentTime - targetTime);
        if (diff > 3) {
          videoRef.current.currentTime = targetTime;
        }
        if (state.isPlaying && videoRef.current.paused) {
          videoRef.current.play().catch(() => {
            videoRef.current.muted = true;
            videoRef.current.play().catch(() => {});
          });
        } else if (!state.isPlaying && !videoRef.current.paused) {
          videoRef.current.pause();
        }
      }
    };

    const unsubUpdate = on('playbackUpdate', handlePlaybackUpdate);
    const unsubThrow = on('throw', (data) => {
      setThrows((prev) => [...prev, { ...data, thrownAt: Date.now() }]);
    });

    return () => {
      unsubUpdate?.();
      unsubThrow?.();
    };
  }, [on, initHls, hlsError]);

  useEffect(() => {
    const interval = setInterval(() => {
      setThrows((prev) => prev.filter((t) => Date.now() - t.thrownAt < 2000));
    }, 500);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
      }
    };
  }, []);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.muted = isMuted;
    }
  }, [isMuted]);

  const handleThrow = useCallback(
    (item) => {
      emit('throw', { item });
    },
    [emit]
  );

  if (!playbackState.movie) {
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
      {hlsError && (
        <div className="hls-error">
          <p>Stream error: {hlsError}</p>
          <button onClick={initHls}>Retry</button>
        </div>
      )}
      <div className="throw-overlay">
        {throws.map((t) => (
          <div
            key={t.id}
            className={`throw-item throw-${t.item} throw-from-${t.side}`}
            style={{ top: `${30 + Math.random() * 40}%` }}
          >
            {t.item === 'tomato' ? '🍅' : '🍿'}
            <span className="throw-name">{t.name}</span>
          </div>
        ))}
      </div>
      <video ref={videoRef} playsInline />
      <div className="player-controls">
        <button
          className="mute-btn"
          onClick={() => setIsMuted((m) => !m)}
          title={isMuted ? 'Unmute' : 'Mute'}
        >
          {isMuted ? '🔇' : '🔊'}
        </button>
      </div>
      <ThrowButton onThrow={handleThrow} />
    </div>
  );
}
