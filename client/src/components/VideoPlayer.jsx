import { useEffect, useRef, useState, useCallback } from 'react';
import Hls from 'hls.js';
import ThrowButton from './ThrowButton.jsx';

export default function VideoPlayer({ userName, isHost, emit, on, sessionData }) {
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const [playbackState, setPlaybackState] = useState(
    sessionData?.playbackState || { movie: null, isPlaying: false, currentTime: 0 }
  );
  const [throws, setThrows] = useState([]);
  const [hlsError, setHlsError] = useState(null);

  const initHls = useCallback(() => {
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    setHlsError(null);

    if (!videoRef.current) return;

    const video = videoRef.current;
    const hlsUrl = `/hls/index.m3u8`;

    if (Hls.isSupported()) {
      const hls = new Hls({
        liveSyncDurationCount: 2,
        lowLatencyMode: true,
        backBufferLength: 30,
      });
      hls.loadSource(hlsUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setPlaybackState((prev) => {
          if (prev.currentTime > 0) {
            video.currentTime = prev.currentTime;
          }
          if (prev.isPlaying) {
            video.play().catch((err) => console.error('[HLS] Play failed:', err));
          }
          return prev;
        });
      });
      hls.on(Hls.Events.ERROR, (_event, data) => {
        console.error('[HLS] Error:', data.type, data.details, data.fatal);
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
    }
  }, []);

  useEffect(() => {
    const handlePlaybackUpdate = (state) => {
      setPlaybackState(state);
      if (state.movie && !hlsRef.current) {
        initHls();
      }

      if (videoRef.current && hlsRef.current && !hlsError) {
        const targetTime = state.currentTime;
        const diff = Math.abs(videoRef.current.currentTime - targetTime);
        if (diff > 3) {
          videoRef.current.currentTime = targetTime;
        }
        if (state.isPlaying && videoRef.current.paused) {
          videoRef.current.play().catch(() => {});
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
      <video ref={videoRef} playsInline muted />
      <ThrowButton onThrow={handleThrow} />
    </div>
  );
}
