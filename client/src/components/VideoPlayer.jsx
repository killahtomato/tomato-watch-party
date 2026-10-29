import { useEffect, useRef, useState, useCallback } from 'react';
import Hls from 'hls.js';
import ThrowButton from './ThrowButton.jsx';

export default function VideoPlayer({ userName, isHost, emit, on }) {
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const syncIntervalRef = useRef(null);
  const [playbackState, setPlaybackState] = useState({ movie: null, isPlaying: false, currentTime: 0 });
  const [throws, setThrows] = useState([]);

  const initHls = useCallback(
    (movieName) => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }

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
          const state = playbackState;
          if (state.currentTime > 0) {
            video.currentTime = state.currentTime;
          }
          if (state.isPlaying) {
            video.play().catch(() => {});
          }
        });
        hlsRef.current = hls;
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = hlsUrl;
      }
    },
    [playbackState]
  );

  useEffect(() => {
    const handlePlaybackUpdate = (state) => {
      setPlaybackState(state);
      if (state.movie && !hlsRef.current) {
        initHls(state.movie);
      }

      if (videoRef.current && hlsRef.current) {
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
    const unsubJoined = on('joined', (data) => {
      if (data.playbackState) handlePlaybackUpdate(data.playbackState);
    });
    const unsubThrow = on('throw', (data) => {
      setThrows((prev) => [...prev, { ...data, thrownAt: Date.now() }]);
    });

    return () => {
      unsubUpdate?.();
      unsubJoined?.();
      unsubThrow?.();
    };
  }, [on, initHls]);

  useEffect(() => {
    if (playbackState.isPlaying) {
      syncIntervalRef.current = setInterval(() => {
        if (videoRef.current && isHost) {
          emit('host:seek', { time: videoRef.current.currentTime });
        }
      }, 8000);
    } else {
      clearInterval(syncIntervalRef.current);
    }

    return () => clearInterval(syncIntervalRef.current);
  }, [playbackState.isPlaying, isHost, emit]);

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
      <video ref={videoRef} controls={isHost} playsInline />
      <ThrowButton onThrow={handleThrow} />
    </div>
  );
}
