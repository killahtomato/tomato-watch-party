import { useEffect, useRef, useState, useCallback } from 'react';
import ThrowButton from './ThrowButton.jsx';

const QUALITY_PRESETS = ['1080p', '720p', '480p'];

export default function VideoPlayer({ userName, isHost, emit, on, sessionData, onTimeUpdate, seekRef, playRef, pauseRef }) {
  const videoRef = useRef(null);
  const playbackRef = useRef({ isPlaying: false, currentTime: 0 });
  const [playbackState, setPlaybackState] = useState(
    sessionData?.playbackState || { movie: null, isPlaying: false, currentTime: 0, transcoding: false, transcodeProgress: 0 }
  );
  const [throws, setThrows] = useState([]);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [splattering, setSplattering] = useState({});
  const [reactionsEnabled, setReactionsEnabled] = useState(true);
  const [movieEnded, setMovieEnded] = useState(false);
  const [videoError, setVideoError] = useState(false);
  const [currentQuality, setCurrentQuality] = useState('1080p');
  const [bufferHealth, setBufferHealth] = useState(0);
  const [showBanner, setShowBanner] = useState(false);

  const streamUrl = playbackState.movie && !playbackState.transcoding
    ? `/stream/${encodeURIComponent(playbackState.movie)}.1080p.mp4`
    : null;
  const myUserId = sessionData?.userId;

  const handleReaction = useCallback(
    (emoji) => {
      emit('throw', { item: emoji });
    },
    [emit]
  );

  useEffect(() => {
    if (!isHost || !videoRef.current) return;

    const syncInterval = setInterval(() => {
      if (videoRef.current && playbackRef.current.isPlaying) {
        emit('host:sync', { position: videoRef.current.currentTime });
      }
    }, 2000);

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

    const handleVideoError = () => {
      setVideoError(true);
      setTimeout(() => {
        if (videoRef.current && streamUrl) {
          videoRef.current.load();
          if (playbackRef.current.isPlaying) {
            videoRef.current.play().catch(() => {});
          }
        }
      }, 2000);
    };

    const handleEnded = () => {
      if (isHost) {
        emit('host:ended', {});
      }
      setMovieEnded(true);
    };

    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('seeked', handleTimeUpdate);
    video.addEventListener('error', handleVideoError);
    video.addEventListener('ended', handleEnded);
    return () => {
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('seeked', handleTimeUpdate);
      video.removeEventListener('error', handleVideoError);
      video.removeEventListener('ended', handleEnded);
    };
  }, [onTimeUpdate, streamUrl, isHost, emit]);

  const tryPlay = useCallback(() => {
    if (!videoRef.current) return;
    const video = videoRef.current;
    const attempt = () => {
      video.play().catch(() => {});
    };
    if (video.readyState >= 2) {
      attempt();
    } else {
      const onCanPlay = () => {
        attempt();
        video.oncanplay = null;
      };
      video.oncanplay = onCanPlay;
    }
  }, []);

  useEffect(() => {
    if (!streamUrl || !videoRef.current) return;

    const video = videoRef.current;

    if (playbackState.currentTime > 0) {
      video.currentTime = playbackState.currentTime;
    }

    if (playbackState.isPlaying) {
      tryPlay();
    }
  }, [streamUrl]);

  useEffect(() => {
    const handlePlaybackUpdate = (state) => {
      setPlaybackState(state);
      playbackRef.current = { isPlaying: state.isPlaying, currentTime: state.currentTime };

      if (state.movie && movieEnded) setMovieEnded(false);
      if (state.isPlaying && videoError) setVideoError(false);

      if (isHost) return;

      if (videoRef.current && streamUrl && !state.transcoding) {
        const video = videoRef.current;
        const targetTime = state.currentTime;
        const diff = Math.abs(video.currentTime - targetTime);

        if (diff > 2 && video.readyState >= 3) {
          video.currentTime = targetTime;
        }

        if (state.isPlaying && video.paused) {
          tryPlay();
        } else if (!state.isPlaying && !video.paused) {
          video.pause();
        }
      }
    };

    const unsubUpdate = on('playbackUpdate', handlePlaybackUpdate);
    const unsubThrow = on('throw', (data) => {
      setThrows((prev) => [...prev, { ...data, thrownAt: Date.now() }]);
    });

    if (
      !videoRef.current &&
      playbackState.movie &&
      playbackState.isPlaying &&
      !playbackState.transcoding
    ) {
      initHls();
    }

    return () => {
      unsubUpdate?.();
      unsubThrow?.();
    };
  }, [on, isHost, streamUrl, movieEnded, videoError]);

  useEffect(() => {
    if (seekRef) {
      seekRef.current = (time) => {
        if (videoRef.current) {
          videoRef.current.currentTime = time;
        }
      };
    }
    if (playRef) {
      playRef.current = () => {
        if (videoRef.current) {
          videoRef.current.muted = false;
          videoRef.current.play().catch(() => {});
        }
      };
    }
  }, [seekRef, playRef]);

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
    if (videoRef.current) {
      videoRef.current.volume = volume;
    }
  }, [volume]);

  useEffect(() => {
    const timers = {};
    throws.forEach((t) => {
      if (!splattering[t.id]) {
        timers[t.id] = setTimeout(() => {
          setSplattering((prev) => ({ ...prev, [t.id]: true }));
        }, 1300);
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

      {movieEnded && playbackState.movie && (
        <div className="movie-ended-overlay">
          <div className="movie-ended-content">
            <span className="movie-ended-icon">🎬</span>
            <h2>The End</h2>
          </div>
        </div>
      )}

      {videoError && !movieEnded && (
        <div className="video-error-overlay">
          <div className="video-error-content">
            <p>Connection lost. Retrying...</p>
          </div>
        </div>
      )}

      {showBanner && !movieEnded && (
        <div className="quality-banner">
          <span className="banner-icon">⚠️</span>
          <span className="banner-text">Connection struggling</span>
          <div className="banner-actions">
            {currentQuality !== '480p' && (
              <button onClick={handleLowerQuality} className="banner-btn">
                Switch to {QUALITY_PRESETS[QUALITY_PRESETS.indexOf(currentQuality) + 1]}
              </button>
            )}
            <button onClick={() => setShowBanner(false)} className="banner-btn dismiss">Dismiss</button>
          </div>
        </div>
      )}

      <div className="throw-overlay">
        {throws.map((t) => {
          const isThrower = t.throwerId === myUserId;
          const isSplatter = splattering[t.id];
          const animClass = isThrower
            ? 'throw-firstperson'
            : t.throwerSide === 'left' ? 'throw-from-left' : 'throw-from-right';
          const style = isThrower
            ? {
                '--throw-x': `${46 + Math.random() * 8}%`,
                '--throw-y': `${55 + Math.random() * 25}%`,
              }
            : {
                '--throw-start-y': `${5 + Math.random() * 20}%`,
                '--throw-end-x': t.throwerSide === 'left' ? `${40 + Math.random() * 15}%` : `${45 + Math.random() * 15}%`,
                '--throw-end-y': `${30 + Math.random() * 30}%`,
              };
          return (
            <div key={t.id} className={`throw-item ${animClass} ${isSplatter ? 'splatter' : ''}`} style={style}>
              {isSplatter
                ? (t.item === 'tomato' ? '🔴' : '💛')
                : (t.item === 'tomato' ? '🍅' : '🍿')}
              {!isSplatter && <span className="throw-name">{t.name}</span>}
            </div>
          );
        })}
      </div>

      <style>{`
        video::-webkit-media-controls { display: none !important; }
        video::-webkit-media-controls-enclosure { display: none !important; }
        video::media-controls { display: none !important; }
      `}</style>
      <video
        ref={videoRef}
        src={streamUrl}
        playsInline
        controls={false}
        disablePictureInPicture
        onDoubleClick={() => {
          if (document.fullscreenElement) {
            document.exitFullscreen();
          } else {
            videoRef.current?.requestFullscreen();
          }
        }}
      />
      <div className="player-controls">
        <select
          className="quality-selector"
          value={currentQuality}
          onChange={(e) => handleManualQualityChange(e.target.value)}
        >
          {QUALITY_PRESETS.map(q => (
            <option key={q} value={q}>{q}</option>
          ))}
        </select>
        <div className="volume-control">
          <button className="mute-btn" onClick={() => setIsMuted(m => !m)} title={isMuted ? 'Unmute' : 'Mute'}>
            {isMuted ? '🔇' : volume > 0.5 ? '🔊' : volume > 0 ? '🔉' : '🔈'}
          </button>
          <input
            type="range" min="0" max="1" step="0.05" value={volume}
            onChange={(e) => setVolume(parseFloat(e.target.value))}
            className="volume-slider"
          />
        </div>
      </div>
      <ThrowButton onThrow={handleReaction} on={on} reactionsEnabled={reactionsEnabled} />
    </div>
  );
}
