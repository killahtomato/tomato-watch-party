import { useEffect, useRef, useState, useCallback } from 'react';
import ThrowButton from './ThrowButton.jsx';

export default function VideoPlayer({ userName, isHost, emit, on, sessionData, onTimeUpdate, seekRef, playRef, pauseRef }) {
  const videoRef = useRef(null);
  const playbackRef = useRef({ isPlaying: false, currentTime: 0 });
  const [playbackState, setPlaybackState] = useState(
    sessionData?.playbackState || { movie: null, isPlaying: false, currentTime: 0, transcoding: false, transcodeProgress: 0 }
  );
  const [throws, setThrows] = useState([]);

  const streamUrl = playbackState.movie ? `/stream/${encodeURIComponent(playbackState.movie)}.mp4` : null;

  const handleThrow = useCallback(
    (item) => {
      emit('throw', { item });
    },
    [emit]
  );

  useEffect(() => {
    const handlePlaybackUpdate = (state) => {
      setPlaybackState(state);
      playbackRef.current = { isPlaying: state.isPlaying, currentTime: state.currentTime };

      if (isHost) return;

      if (videoRef.current && streamUrl) {
        const targetTime = state.currentTime;
        const diff = Math.abs(videoRef.current.currentTime - targetTime);
        if (diff > 1) {
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
  }, [on, isHost, streamUrl]);

  useEffect(() => {
    if (!isHost || !videoRef.current) return;

    const syncInterval = setInterval(() => {
      if (videoRef.current && playbackRef.current.isPlaying) {
        emit('host:sync', { position: videoRef.current.currentTime });
      }
    }, 1000);

    return () => clearInterval(syncInterval);
  }, [isHost, emit]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleTimeUpdate = () => {
      if (onTimeUpdate) {
        onTimeUpdate(video.currentTime);
      }
    };

    video.addEventListener('timeupdate', handleTimeUpdate);
    return () => video.removeEventListener('timeupdate', handleTimeUpdate);
  }, [onTimeUpdate, streamUrl]);

  useEffect(() => {
    const interval = setInterval(() => {
      setThrows((prev) => prev.filter((t) => Date.now() - t.thrownAt < 2000));
    }, 500);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (seekRef) {
      seekRef.current = (time) => {
        if (videoRef.current) {
          videoRef.current.currentTime = time;
        }
      };
    }
  }, [seekRef]);

  useEffect(() => {
    if (playRef) {
      playRef.current = () => {
        if (videoRef.current) {
          videoRef.current.muted = false;
          videoRef.current.play().catch(() => {
            videoRef.current.muted = true;
            videoRef.current.play().catch(() => {});
          });
        }
      };
    }
  }, [playRef]);

  useEffect(() => {
    if (pauseRef) {
      pauseRef.current = () => {
        if (videoRef.current) {
          videoRef.current.pause();
        }
      };
    }
  }, [pauseRef]);

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

  if (playbackState.transcoding) {
    return (
      <div className="video-player empty">
        <div className="waiting-message">
          <h2>Preparing movie...</h2>
          <div className="transcode-progress">
            <div className="progress-bar">
              <div
                className="progress-fill"
                style={{ width: `${playbackState.transcodeProgress}%` }}
              />
            </div>
            <p>{playbackState.transcodeProgress}% — Please wait</p>
          </div>
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
      <video ref={videoRef} src={streamUrl} playsInline />
      <div className="player-controls">
        <button
          className="mute-btn"
          onClick={() => {
            if (videoRef.current) {
              videoRef.current.muted = !videoRef.current.muted;
            }
          }}
          title="Toggle sound"
        >
          🔊
        </button>
      </div>
      <ThrowButton onThrow={handleThrow} />
    </div>
  );
}
