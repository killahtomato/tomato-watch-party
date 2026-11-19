import { useEffect, useRef, useState, useCallback } from 'react';
import { parseVtt, formatLabel } from '../utils/subtitles';
import { readSettings, writeSettings } from '../utils/settings.js';

const QUALITY_PRESETS = ['1080p', '720p', '480p'];

export default function MovieRoom({ emit, on, sessionData, userName, unlocked, isActive = true }) {
  const saved = useRef(readSettings()).current;
  const videoRef = useRef(null);
  const containerRef = useRef(null);
  const seekingRef = useRef(false);
  const controlsTimerRef = useRef(null);
  const endTimerRef = useRef(null);
  const splatterTimersRef = useRef({});
  const retryTimerRef = useRef(null);
  const streamUrlRef = useRef(null);
  const retryCountRef = useRef(0);

  const [playbackState, setPlaybackState] = useState(
    sessionData?.playbackState || { movie: null, isPlaying: false, currentTime: 0, transcoding: false, transcodeProgress: 0 }
  );
  const [currentQuality, setCurrentQuality] = useState(saved.movieQuality || '1080p');
  const [selectedAudio, setSelectedAudio] = useState(saved.movieAudio ?? 0);
  const [selectedSubtitle, setSelectedSubtitle] = useState(saved.movieSubtitle ?? -1);
  const [trackInfo, setTrackInfo] = useState({ audio: [], subs: [] });
  const [subEntries, setSubEntries] = useState([]);
  const [currentSubText, setCurrentSubText] = useState('');
  const [progress, setProgress] = useState(0);
  const [volume, setVolume] = useState(saved.movieVolume ?? 1);
  const [isMuted, setIsMuted] = useState(saved.movieMuted ?? false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [throws, setThrows] = useState([]);
  const [splattering, setSplattering] = useState({});
  const [reactions, setReactions] = useState([]);
  const [videoError, setVideoError] = useState(false);
  const [movieEnded, setMovieEnded] = useState(false);
  const [loading, setLoading] = useState(false);

  const playbackRef = useRef(playbackState);
  playbackRef.current = playbackState;
  const unlockedRef = useRef(unlocked);
  unlockedRef.current = unlocked;
  const activeRef = useRef(isActive);
  activeRef.current = isActive;

  const myUserId = sessionData?.userId;

  const [movieList, setMovieList] = useState([]);

  useEffect(() => {
    fetch('/api/movies').then(r => r.json()).then(setMovieList).catch(() => {});
  }, []);

  const currentMovie = movieList.find(m => m.name === playbackState.movie);
  const displayTitle = currentMovie?.displayName || playbackState.movie?.replace(/\.[^.]+$/, '') || '';

  useEffect(() => {
    writeSettings({
      movieQuality: currentQuality,
      movieAudio: selectedAudio,
      movieSubtitle: selectedSubtitle,
      movieVolume: volume,
      movieMuted: isMuted,
    });
  }, [currentQuality, selectedAudio, selectedSubtitle, volume, isMuted]);

  useEffect(() => {
    if (isActive && sessionData?.playbackState) {
      setPlaybackState(sessionData.playbackState);
    }
  }, [isActive, sessionData?.playbackState]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (!isActive) {
      video.pause();
    } else if (playbackRef.current.isPlaying && unlockedRef.current) {
      video.play().catch(() => {});
    }
  }, [isActive, unlocked]);

  const streamUrl = playbackState.movie && !playbackState.transcoding
    ? selectedAudio === 0
      ? `/stream/${encodeURIComponent(playbackState.movie)}/${currentQuality}.mp4`
      : `/api/stream-file/${encodeURIComponent(playbackState.movie)}/${currentQuality}?audio=${selectedAudio}&sub=-1`
    : null;

  useEffect(() => {
    if (streamUrlRef.current === streamUrl) return;
    streamUrlRef.current = streamUrl;
    retryCountRef.current = 0;
    clearTimeout(retryTimerRef.current);
    setVideoError(false);
    setLoading(!!streamUrl);
  }, [streamUrl]);

  useEffect(() => {
    if (!playbackState?.movie) return;
    fetch(`/api/movie/${encodeURIComponent(playbackState.movie)}/tracks`)
      .then(r => r.json())
      .then(data => {
        setTrackInfo(data);
        setSubEntries([]);
      })
      .catch(() => {});
  }, [playbackState?.movie]);

  useEffect(() => {
    if (!playbackState?.movie || selectedSubtitle < 0) {
      setSubEntries([]);
      return;
    }
    const track = trackInfo.subs[selectedSubtitle];
    if (!track) {
      setSubEntries([]);
      return;
    }
    fetch(`/api/subs/${encodeURIComponent(playbackState.movie)}/${currentQuality}/${selectedSubtitle}`)
      .then(r => r.text())
      .then(text => setSubEntries(parseVtt(text)))
      .catch(() => setSubEntries([]));
  }, [playbackState?.movie, currentQuality, selectedSubtitle, trackInfo]);

  useEffect(() => {
    const handleUpdate = (state) => {
      const previousMovie = playbackRef.current.movie;
      setPlaybackState(state);
      if (state.movie && state.movie !== previousMovie) {
        setMovieEnded(false);
        setProgress(0);
        if (endTimerRef.current) clearTimeout(endTimerRef.current);
      }
      if (videoError && state.isPlaying) setVideoError(false);
      if (videoError && !state.transcoding) setVideoError(false);
      const video = videoRef.current;
      if (!video || !activeRef.current || state.transcoding || !state.movie) return;
      if (state.movie !== previousMovie) return;
      const diff = Math.abs(video.currentTime - state.currentTime);
      if (diff > 2 && !seekingRef.current && video.readyState >= 2) {
        video.currentTime = state.currentTime;
      }
      if (state.isPlaying && video.paused && unlockedRef.current) {
        video.play().catch(() => {});
      } else if (!state.isPlaying && !video.paused) {
        video.pause();
      }
    };
    const unsub = on('playbackUpdate', handleUpdate);
    return () => unsub?.();
  }, [on, videoError]);

  useEffect(() => {
    const unsubThrow = on('throw', (data) => {
      setThrows(prev => [...prev, { ...data, thrownAt: Date.now() }]);
      splatterTimersRef.current[data.id] = setTimeout(() => {
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
      unsubThrow?.();
      unsubReaction?.();
      Object.values(splatterTimersRef.current).forEach(clearTimeout);
    };
  }, [on]);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.volume = volume;
      videoRef.current.muted = isMuted || !isActive;
    }
  }, [isMuted, isActive, volume]);

  useEffect(() => {
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
    const handleFullscreenChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  useEffect(() => () => {
    clearTimeout(controlsTimerRef.current);
    clearTimeout(endTimerRef.current);
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
    if (!video || !video.duration) return;
    setProgress(Math.min(100, (video.currentTime / video.duration) * 100));
  }, []);

  const handleVideoError = useCallback(() => {
    if (!activeRef.current) return;
    if (!streamUrlRef.current || retryCountRef.current >= 2) {
      setLoading(false);
      setVideoError(true);
      return;
    }
    setVideoError(true);
    retryCountRef.current += 1;
    clearTimeout(retryTimerRef.current);
    retryTimerRef.current = setTimeout(() => {
      const video = videoRef.current;
      if (activeRef.current && video && streamUrlRef.current) {
        video.load();
        if (playbackRef.current.isPlaying && unlockedRef.current) video.play().catch(() => {});
      }
    }, 2000 * retryCountRef.current);
  }, []);

  const handleCanPlay = useCallback(() => {
    setLoading(false);
    setVideoError(false);
    clearTimeout(retryTimerRef.current);
  }, []);

  const handleEnded = useCallback(() => {
    endTimerRef.current = setTimeout(() => setMovieEnded(true), 1500);
  }, []);

  const toggleFullscreen = useCallback(async () => {
    const video = videoRef.current;
    const container = containerRef.current;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
      return;
    }
    if (container?.requestFullscreen) {
      try {
        await container.requestFullscreen();
        return;
      } catch {}
    }
    if (video?.webkitEnterFullscreen) {
      video.webkitEnterFullscreen();
    } else if (video?.requestFullscreen) {
      try { await video.requestFullscreen(); } catch {}
    }
  }, []);

  const showControls = controlsVisible || !playbackState.isPlaying || movieEnded;

  if (!playbackState.movie) {
    return (
      <div className="m-movie-room m-movie-empty">
        <div className="m-empty-box">
          <span className="m-empty-icon">🎬</span>
          <h2>Waiting for the show to start...</h2>
          <p>The host will begin streaming shortly.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="m-movie-room" ref={containerRef}>
      <video
        ref={videoRef}
        className="m-video"
        key={streamUrl || 'no-stream'}
        src={streamUrl}
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
        onEnded={handleEnded}
      />

      <div className="m-progress-bar">
        <div className="m-progress-fill" style={{ width: `${progress}%` }} />
      </div>

      <div className="m-movie-info">
        <span className="m-movie-title">{displayTitle}</span>
      </div>

      {loading && !playbackState.transcoding && !movieEnded && (
        <div className="m-loading">
          <div className="m-spinner" />
          <p>Loading...</p>
        </div>
      )}

      {playbackState.transcoding && (
        <div className="m-transcode">
          <div className="m-empty-box">
            <span className="m-empty-icon">🍅</span>
            <h2>Preparing movie...</h2>
            <div className="m-transcode-bar">
              <div className="m-transcode-fill" style={{ width: `${playbackState.transcodeProgress}%` }} />
            </div>
            <p>{playbackState.transcodeProgress}% — Please wait</p>
          </div>
        </div>
      )}

      {movieEnded && !playbackState.transcoding && (
        <div className="m-end-overlay">
          <div className="m-end-box">
            <span className="m-end-icon">🎬</span>
            <h2>The End</h2>
            <p>Thank you for watching! :3</p>
          </div>
        </div>
      )}

      {videoError && !movieEnded && (
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
        <div className="m-controls-row m-selects">
          <select className="m-select" value={currentQuality} onChange={e => setCurrentQuality(e.target.value)} title="Quality">
            {QUALITY_PRESETS.map(q => <option key={q} value={q}>{q}</option>)}
          </select>
          <select
            className="m-select"
            value={selectedAudio}
            onChange={e => setSelectedAudio(parseInt(e.target.value, 10))}
            title="Audio track"
          >
            {trackInfo.audio.length > 0
              ? trackInfo.audio.map((t, i) => <option key={i} value={i}>{formatLabel(t.tags?.language, t.tags?.title)}</option>)
              : <option value={0}>Default audio</option>}
          </select>
          <select
            className="m-select"
            value={selectedSubtitle}
            onChange={e => setSelectedSubtitle(parseInt(e.target.value, 10))}
            title="Subtitles"
          >
            <option value={-1}>Subs: Off</option>
            {trackInfo.subs.map((t, i) => <option key={i} value={i}>{formatLabel(t.tags?.language, t.tags?.title)}</option>)}
          </select>
        </div>
      </div>

    </div>
  );
}
