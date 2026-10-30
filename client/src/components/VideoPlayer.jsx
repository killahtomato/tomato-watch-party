import { useEffect, useRef, useState, useCallback } from 'react';
import ThrowButton from './ThrowButton.jsx';

export default function VideoPlayer({ userName, isHost, emit, on, sessionData, onTimeUpdate, seekRef, playRef, pauseRef }) {
  const videoRef = useRef(null);
  const playbackRef = useRef({ isPlaying: false, currentTime: 0 });
  const [playbackState, setPlaybackState] = useState(
    sessionData?.playbackState || { movie: null, isPlaying: false, currentTime: 0, transcoding: false, transcodeProgress: 0 }
  );
  const [throws, setThrows] = useState([]);
  const [reactions, setReactions] = useState([]);
  const [isMuted, setIsMuted] = useState(false);
  const [splattering, setSplattering] = useState({});
  const [reactionsEnabled, setReactionsEnabled] = useState(true);

  const streamUrl = playbackState.movie ? `/stream/${encodeURIComponent(playbackState.movie)}.mp4` : null;
  const myUserId = sessionData?.userId;

  const handleReaction = useCallback(
    (emoji) => {
      if (!reactionsEnabled) return;
      emit('reaction', { emoji });
    },
    [emit, reactionsEnabled]
  );

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
    const unsubReaction = on('reaction', (data) => {
      setReactions((prev) => [...prev, data]);
      setTimeout(() => {
        setReactions((prev) => prev.filter(r => r.id !== data.id));
      }, 2000);
    });
    const unsubReactionsEnabled = on('reactions:enabled', (enabled) => {
      setReactionsEnabled(enabled);
    });
    return () => {
      unsubUpdate?.();
      unsubThrow?.();
      unsubReaction?.();
      unsubReactionsEnabled?.();
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
    video.addEventListener('seeked', handleTimeUpdate);
    return () => {
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('seeked', handleTimeUpdate);
    };
  }, [onTimeUpdate, streamUrl]);

  useEffect(() => {
    if (!streamUrl) return;
    const interval = setInterval(() => {
      if (videoRef.current && onTimeUpdate) {
        onTimeUpdate(videoRef.current.currentTime);
      }
    }, 500);
    return () => clearInterval(interval);
  }, [streamUrl, onTimeUpdate]);

  useEffect(() => {
    if (!isHost) return;
    const video = videoRef.current;
    if (!video) return;

    const handleEnded = () => {
      emit('host:ended', {});
    };

    video.addEventListener('ended', handleEnded);
    return () => video.removeEventListener('ended', handleEnded);
  }, [isHost, emit, streamUrl]);

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



  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.muted = isMuted;
    }
  }, [isMuted]);

  useEffect(() => {
    const timers = {};
    throws.forEach(t => {
      if (!splattering[t.id]) {
        timers[t.id] = setTimeout(() => {
          setSplattering(prev => ({ ...prev, [t.id]: true }));
        }, 1300);
      }
    });
    return () => Object.values(timers).forEach(clearTimeout);
  }, [throws]);

  useEffect(() => {
    const ids = Object.keys(splattering);
    if (ids.length > 0) {
      const timer = setTimeout(() => {
        setThrows(prev => prev.filter(t => !ids.includes(t.id)));
        setSplattering(prev => {
          const next = { ...prev };
          ids.forEach(id => delete next[id]);
          return next;
        });
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [splattering]);

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
      {playbackState.transcoding && (
        <div className="transcode-overlay">
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
      )}
      <div className="throw-overlay">
        {reactions.map((r) => (
          <div
            key={r.id}
            className="throw-item reaction-item"
            style={{ '--drift': `${(Math.random() - 0.5) * 20}px` }}
          >
            {r.emoji}
            <span className="throw-name">{r.name}</span>
          </div>
        ))}

        {throws.map((t) => {
          const isThrower = t.throwerId === myUserId;
          const isSplatter = splattering[t.id];
          const animClass = isThrower
            ? 'throw-firstperson'
            : t.throwerSide === 'left' ? 'throw-from-left' : 'throw-from-right';

          const style = isThrower
            ? {
                '--throw-x': `${48 + Math.random() * 4}%`,
                '--throw-y': `${60 + Math.random() * 25}%`,
              }
            : {
                '--throw-start-y': `${5 + Math.random() * 20}%`,
                '--throw-end-x': t.throwerSide === 'left' ? `${40 + Math.random() * 15}%` : `${45 + Math.random() * 15}%`,
                '--throw-end-y': `${30 + Math.random() * 30}%`,
              };

          return (
            <div
              key={t.id}
              className={`throw-item ${animClass} ${isSplatter ? 'splatter' : ''}`}
              style={style}
            >
              {isSplatter
                ? (t.item === 'tomato' ? '🔴' : '💛')
                : (t.item === 'tomato' ? '🍅' : '🍿')}
              {!isSplatter && <span className="throw-name">{t.name}</span>}
            </div>
          );
        })}
      </div>
      <video ref={videoRef} src={playbackState.transcoding ? undefined : streamUrl} playsInline />
      <div className="player-controls">
        <button
          className="mute-btn"
          onClick={() => setIsMuted(m => !m)}
          title={isMuted ? 'Unmute' : 'Mute'}
        >
          {isMuted ? '🔇' : '🔊'}
        </button>
      </div>
      <ThrowButton onThrow={handleThrow} on={on} reactionsEnabled={reactionsEnabled} onReaction={handleReaction} />
    </div>
  );
}
