import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import ThrowButton from './ThrowButton.jsx';

const QUALITY_PRESETS = ['1080p', '720p', '480p'];

function parseVtt(text) {
  const lines = text.trim().split(/\r?\n/);
  const entries = [];
  let current = null;
  for (const line of lines) {
    const timeMatch = line.match(/^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})[.,](\d{1,3})\s*-->\s*(?:(\d{1,2}):)?(\d{1,2}):(\d{2})[.,](\d{1,3})/);
    if (timeMatch) {
      if (current && current.text) entries.push(current);
      const h1 = timeMatch[1] ? parseInt(timeMatch[1]) : 0;
      const start = h1 * 3600 + parseInt(timeMatch[2]) * 60 + parseInt(timeMatch[3]) + parseInt(timeMatch[4].padEnd(3, '0')) / 1000;
      const h2 = timeMatch[5] ? parseInt(timeMatch[5]) : 0;
      const end = h2 * 3600 + parseInt(timeMatch[6]) * 60 + parseInt(timeMatch[7]) + parseInt(timeMatch[8].padEnd(3, '0')) / 1000;
      current = { start, end, text: '' };
    } else if (current && line.trim() && !line.startsWith('WEBVTT') && !line.startsWith('NOTE') && !line.match(/^\d+$/)) {
      const cleanLine = line.replace(/<[^>]+>/g, '').trim();
      if (cleanLine) {
        current.text += (current.text ? '\n' : '') + cleanLine;
      }
    }
  }
  if (current && current.text) entries.push(current);
  return entries;
}

const LANG_MAP = {
  eng: 'English', jpn: 'Japanese', ara: 'Arabic', cat: 'Catalan', cze: 'Czech',
  dan: 'Danish', ger: 'German', gre: 'Greek', spa: 'Spanish', baq: 'Basque',
  fin: 'Finnish', fil: 'Filipino', fre: 'French', glg: 'Galician', heb: 'Hebrew',
  hrv: 'Croatian', hun: 'Hungarian', ind: 'Indonesian', ita: 'Italian', kor: 'Korean',
  may: 'Malay', nob: 'Norwegian', dut: 'Dutch', pol: 'Polish', por: 'Portuguese',
  rum: 'Romanian', rus: 'Russian', swe: 'Swedish', tha: 'Thai', tur: 'Turkish',
  ukr: 'Ukrainian', vie: 'Vietnamese', chi: 'Chinese', und: 'Unknown',
};

function formatLabel(lang, title) {
  const langName = LANG_MAP[lang] || lang.toUpperCase();
  if (title) return `${langName} (${title})`;
  return langName;
}

export default function VideoPlayer({ userName, isHost, emit, on, sessionData, onTimeUpdate, seekRef, playRef, pauseRef, isActive = true }) {
  const videoRef = useRef(null);
  const audioRef = useRef(null);
  const playbackRef = useRef({ isPlaying: false, currentTime: 0 });
  const isQualitySwitching = useRef(false);
  const lastSeekTime = useRef(0);
  const subIntervalRef = useRef(null);
  const [playbackState, setPlaybackState] = useState(
    sessionData?.playbackState || { movie: null, isPlaying: false, currentTime: 0, transcoding: false, transcodeProgress: 0 }
  );
  const [throws, setThrows] = useState([]);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [splattering, setSplattering] = useState({});
  const [reactionsEnabled, setReactionsEnabled] = useState(true);
  const [reactions, setReactions] = useState([]);
  const [movieEnded, setMovieEnded] = useState(false);
  const [videoError, setVideoError] = useState(false);
  const [currentQuality, setCurrentQuality] = useState('1080p');
  const [bufferHealth, setBufferHealth] = useState(0);
  const [pingMs, setPingMs] = useState(0);
  const [showBanner, setShowBanner] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [subtitleTracks, setSubtitleTracks] = useState([]);
  const [selectedSubtitle, setSelectedSubtitle] = useState(-1);
  const [audioTracks, setAudioTracks] = useState([]);
  const [selectedAudio, setSelectedAudio] = useState(0);
  const [trackInfo, setTrackInfo] = useState({ audio: [], subs: [] });
  const [subEntries, setSubEntries] = useState([]);
  const [currentSubText, setCurrentSubText] = useState('');

  const streamUrl = useMemo(() => {
    return playbackState.movie && !playbackState.transcoding
      ? `/stream/${encodeURIComponent(playbackState.movie)}/${currentQuality}.mp4`
      : null;
  }, [playbackState.movie, playbackState.transcoding, currentQuality]);

  const audioUrl = useMemo(() => {
    if (!playbackState?.movie || playbackState.transcoding || trackInfo.audio.length === 0) return null;
    return `/api/audio/${encodeURIComponent(playbackState.movie)}/${currentQuality}/${selectedAudio}`;
  }, [playbackState?.movie, playbackState.transcoding, currentQuality, trackInfo, selectedAudio]);

  const myUserId = sessionData?.userId;

  const addToast = useCallback((message, type = 'info') => {
    const id = Date.now() + Math.random();
    setToasts(prev => [...prev.slice(-2), { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 3000);
  }, []);

  const handleThrow = useCallback((item) => {
    emit('throw', { item });
  }, [emit]);

  const handleReaction = useCallback((emoji) => {
    emit('reaction', { emoji });
  }, [emit]);

  useEffect(() => {
    if (!isHost) return;
    const syncInterval = setInterval(() => {
      if (isQualitySwitching.current) return;
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
      if (onTimeUpdate && video.duration > 0) {
        onTimeUpdate(Math.round((video.currentTime / video.duration) * 1000) / 10);
      }
    };
    const handleSeeked = () => {
      lastSeekTime.current = Date.now();
      if (onTimeUpdate && video.duration > 0) {
        onTimeUpdate(Math.round((video.currentTime / video.duration) * 1000) / 10);
      }
    };
    const handleVideoError = () => {
      setVideoError(true);
      setTimeout(() => {
        if (videoRef.current && streamUrl) {
          videoRef.current.load();
          if (playbackRef.current.isPlaying) videoRef.current.play().catch(() => {});
        }
      }, 2000);
    };
    const handleEnded = () => {
      if (isHost) emit('host:ended', {});
      setMovieEnded(true);
    };

    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('seeked', handleSeeked);
    video.addEventListener('error', handleVideoError);
    video.addEventListener('ended', handleEnded);

    const poll1 = setInterval(() => {
      const v = videoRef.current;
      const since = Date.now() - lastSeekTime.current;
      if (since > 2000 && v && onTimeUpdate && v.duration > 0) {
        onTimeUpdate(Math.round((v.currentTime / v.duration) * 1000) / 10);
      }
    }, 200);

    const poll2 = setInterval(() => {
      const v = videoRef.current;
      const since = Date.now() - lastSeekTime.current;
      if (since < 2000 && v && onTimeUpdate && v.duration > 0) {
        onTimeUpdate(Math.round((v.currentTime / v.duration) * 1000) / 10);
      }
    }, 100);

    return () => {
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('seeked', handleSeeked);
      video.removeEventListener('error', handleVideoError);
      video.removeEventListener('ended', handleEnded);
      clearInterval(poll1);
      clearInterval(poll2);
    };
  }, [onTimeUpdate, streamUrl, isHost, emit]);

  useEffect(() => {
    if (!playbackState?.movie) return;
    fetch(`/api/movie/${encodeURIComponent(playbackState.movie)}/tracks`)
      .then(r => r.json())
      .then(data => {
        setTrackInfo(data);
        setSubtitleTracks((data.subs || []).map((s, i) => ({
          index: s.index,
          label: formatLabel(s.tags?.language, s.tags?.title),
        })));
        setAudioTracks((data.audio || []).map((a, i) => ({
          index: a.index,
          label: formatLabel(a.tags?.language, a.tags?.title),
        })));
        if (data.audio && data.audio.length > 0) {
          setSelectedAudio(0);
        }
      })
      .catch(() => {});
  }, [playbackState?.movie]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !audioUrl) return;

    const onCanPlay = () => {
      const video = videoRef.current;
      if (video) {
        audio.currentTime = video.currentTime;
        if (!video.paused) audio.play().catch(() => {});
      }
      audio.removeEventListener('canplay', onCanPlay);
    };

    audio.addEventListener('canplay', onCanPlay);
    audio.src = audioUrl;

    return () => audio.removeEventListener('canplay', onCanPlay);
  }, [audioUrl]);

  useEffect(() => {
    const audio = audioRef.current;
    const video = videoRef.current;
    if (!audio || !video) return;

    const audioSync = setInterval(() => {
      if (!video.paused && !audio.paused) {
        const diff = Math.abs(audio.currentTime - video.currentTime);
        if (diff > 0.3) audio.currentTime = video.currentTime;
      }
    }, 250);

    const onPlay = () => {
      audio.currentTime = video.currentTime;
      audio.play().catch(() => {});
    };
    const onPause = () => audio.pause();
    const onSeeked = () => { audio.currentTime = video.currentTime; };

    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('seeked', onSeeked);

    return () => {
      clearInterval(audioSync);
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('seeked', onSeeked);
    };
  }, [streamUrl]);

  useEffect(() => {
    if (selectedSubtitle < 0) {
      setSubEntries([]);
      setCurrentSubText('');
      return;
    }
    const track = trackInfo.subs[selectedSubtitle];
    if (!track) return;

    fetch(`/api/subs/${encodeURIComponent(playbackState.movie)}/${currentQuality}/${selectedSubtitle}`)
      .then(r => r.text())
      .then(text => setSubEntries(parseVtt(text)))
      .catch(() => setSubEntries([]));
  }, [selectedSubtitle, playbackState?.movie, currentQuality, trackInfo]);

  useEffect(() => {
    if (subIntervalRef.current) clearInterval(subIntervalRef.current);
    if (subEntries.length === 0) { setCurrentSubText(''); return; }

    subIntervalRef.current = setInterval(() => {
      const video = videoRef.current;
      if (!video) return;
      const t = video.currentTime;
      const entry = subEntries.find(e => t >= e.start && t <= e.end);
      setCurrentSubText(entry ? entry.text : '');
    }, 100);

    return () => { if (subIntervalRef.current) clearInterval(subIntervalRef.current); };
  }, [subEntries]);

  const handleAudioChange = useCallback((e) => {
    setSelectedAudio(parseInt(e.target.value));
  }, []);

  const handleSubtitleChange = useCallback((e) => {
    setSelectedSubtitle(parseInt(e.target.value));
  }, []);

  const tryPlay = useCallback(() => {
    if (!videoRef.current) return;
    const video = videoRef.current;
    if (video.readyState >= 2) {
      video.play().catch(() => {});
    } else {
      const onCanPlay = () => { video.play().catch(() => {}); video.oncanplay = null; };
      video.oncanplay = onCanPlay;
    }
    const audio = audioRef.current;
    if (audio && audio.src) {
      audio.currentTime = video.currentTime;
      audio.play().catch(() => {});
    }
  }, []);

  useEffect(() => {
    if (!on) return;
    const unsubForce = on('forceQuality', (data) => {
      setCurrentQuality(data.quality);
      addToast && addToast(`Quality forced to ${data.quality}`, 'forced');
    });
    const unsubQualityChange = on('qualityChange', (data) => {
      if (!isHost) setCurrentQuality(data.quality);
    });
    return () => { unsubForce?.(); unsubQualityChange?.(); };
  }, [on, isHost, addToast]);

  useEffect(() => {
    const handlePlaybackUpdate = (state) => {
      setPlaybackState(state);
      playbackRef.current = { isPlaying: state.isPlaying, currentTime: state.currentTime };
      if (state.movie && movieEnded) setMovieEnded(false);
      if (state.isPlaying && videoError) setVideoError(false);
      if (!state.transcoding && videoError) setVideoError(false);
      if (isHost) return;
      if (isQualitySwitching.current) return;

      const video = videoRef.current;
      if (video && streamUrl && !state.transcoding) {
        const targetTime = state.currentTime;
        const diff = Math.abs(video.currentTime - targetTime);
        const threshold = state.forceResync ? 0.1 : 4;
        if (diff > threshold && video.readyState >= 3) video.currentTime = targetTime;
        if (state.isPlaying && video.paused && video.readyState >= 2) tryPlay();
        else if (!state.isPlaying && !video.paused) video.pause();
      }
    };

    const unsubUpdate = on('playbackUpdate', handlePlaybackUpdate);
    const unsubThrow = on('throw', (data) => {
      setThrows((prev) => [...prev, { ...data, thrownAt: Date.now() }]);
    });
    const unsubReaction = on('reaction', (data) => {
      setReactions((prev) => [...prev, { ...data, receivedAt: Date.now(), posX: 25 + Math.random() * 50 }]);
    });
    return () => { unsubUpdate?.(); unsubThrow?.(); unsubReaction?.(); };
  }, [on, isHost, streamUrl, movieEnded, videoError]);

  useEffect(() => {
    const interval = setInterval(() => {
      const video = videoRef.current;
      if (!video || !playbackState.isPlaying) { setBufferHealth(0); return; }
      const buffered = video.buffered;
      let bufferEnd = 0;
      for (let i = 0; i < buffered.length; i++) {
        if (buffered.start(i) <= video.currentTime) bufferEnd = Math.max(bufferEnd, buffered.end(i));
      }
      const health = bufferEnd - video.currentTime;
      setBufferHealth(health);
      if (!isHost && playbackState.movie) {
        emit('viewer:health', { bufferHealth: health, drift: Math.abs(playbackState.currentTime - video.currentTime), pingMs });
      }
      if (health > 0 && health < 5 && Math.abs(playbackState.currentTime - video.currentTime) > 5) {
        if (!showBanner) setShowBanner(true);
      }
      if (health > 15 && showBanner) {
        if (currentQuality !== '1080p' && !isHost) handleRaiseQuality();
        setShowBanner(false);
      }
    }, 500);
    return () => clearInterval(interval);
  }, [playbackState.isPlaying, playbackState.currentTime, isHost, showBanner, currentQuality, pingMs]);

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
    if (seekRef) seekRef.current = (time) => { if (videoRef.current) videoRef.current.currentTime = time; };
    if (playRef) playRef.current = () => { if (videoRef.current) videoRef.current.play().catch(() => {}); };
    if (pauseRef) pauseRef.current = () => { if (videoRef.current) videoRef.current.pause(); };
  }, [seekRef, playRef, pauseRef]);

  useEffect(() => {
    const audio = audioRef.current;
    if (audio) audio.volume = isMuted ? 0 : volume;
  }, [isMuted, volume]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.muted = !isActive;
    }
    if (isActive && playbackState.isPlaying) {
      const video = videoRef.current;
      if (video && video.paused) {
        video.play().catch(() => {});
      }
      if (audioRef.current && audioRef.current.paused && audioRef.current.src) {
        audioRef.current.play().catch(() => {});
      }
    }
  }, [isActive, playbackState.isPlaying]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.volume = 0;
  }, [streamUrl]);

  useEffect(() => {
    const timers = {};
    throws.forEach(t => {
      if (!splattering[t.id]) {
        timers[t.id] = setTimeout(() => setSplattering(prev => ({ ...prev, [t.id]: true })), 1300);
      }
    });
    return () => Object.values(timers).forEach(clearTimeout);
  }, [throws]);

  useEffect(() => {
    const ids = Object.keys(splattering);
    if (ids.length > 0) {
      const timer = setTimeout(() => {
        setThrows(prev => prev.filter(t => !ids.includes(t.id)));
        setSplattering(prev => { const next = { ...prev }; ids.forEach(id => delete next[id]); return next; });
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [splattering]);

  useEffect(() => {
    if (reactions.length === 0) return;
    const timer = setTimeout(() => {
      setReactions(prev => prev.filter(r => Date.now() - r.receivedAt < 900));
    }, 900);
    return () => clearTimeout(timer);
  }, [reactions]);

  const handleLowerQuality = useCallback(() => {
    const idx = QUALITY_PRESETS.indexOf(currentQuality);
    if (idx < QUALITY_PRESETS.length - 1) {
      setCurrentQuality(QUALITY_PRESETS[idx + 1]);
      addToast(`Auto-switched to ${QUALITY_PRESETS[idx + 1]}`, 'info');
    }
  }, [currentQuality, addToast]);

  const handleRaiseQuality = useCallback(() => {
    const idx = QUALITY_PRESETS.indexOf(currentQuality);
    if (idx > 0) {
      setCurrentQuality(QUALITY_PRESETS[idx - 1]);
      addToast(`Quality restored to ${QUALITY_PRESETS[idx - 1]}`, 'success');
    }
  }, [currentQuality, addToast]);

  const handleManualQualityChange = useCallback((quality) => {
    if (quality !== currentQuality) {
      setCurrentQuality(quality);
      setShowBanner(false);
      if (isHost) emit('host:qualityChange', { quality });
      else addToast(`Switched to ${quality}`, 'info');
    }
  }, [currentQuality, isHost, emit, addToast]);

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
                <div className="progress-fill" style={{ width: `${playbackState.transcodeProgress}%` }} />
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

      <div className="toast-stack">
        {toasts.map((t, i) => (
          <div key={t.id} className={`toast toast-${t.type}`} style={{ top: `${i * 40}px` }}>
            <span>{t.message}</span>
            <button className="toast-close" onClick={() => setToasts(prev => prev.filter(toast => toast.id !== t.id))}>✕</button>
          </div>
        ))}
      </div>

      <div className="throw-overlay">
        {throws.map((t) => {
          const isThrower = t.throwerId === myUserId;
          const isSplatter = splattering[t.id];
          const animClass = isThrower ? 'throw-firstperson' : t.throwerSide === 'left' ? 'throw-from-left' : 'throw-from-right';
          const style = isThrower
            ? { '--throw-x': `${46 + Math.random() * 8}%`, '--throw-y': `${55 + Math.random() * 25}%` }
            : { '--throw-start-y': `${5 + Math.random() * 20}%`, '--throw-end-x': t.throwerSide === 'left' ? `${40 + Math.random() * 15}%` : `${45 + Math.random() * 15}%`, '--throw-end-y': `${30 + Math.random() * 30}%` };
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

      {currentSubText && (
        <div className="subtitle-overlay">
          <span>{currentSubText}</span>
        </div>
      )}

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
        muted
        onDoubleClick={() => {
          if (document.fullscreenElement) document.exitFullscreen();
          else videoRef.current?.requestFullscreen();
        }}
      />
      <audio ref={audioRef} preload="auto" playsInline style={{ position: 'absolute', left: '-9999px', width: '1px', height: '1px' }} />
      <div className="player-controls-left">
        <select className="audio-selector" value={selectedAudio} onChange={handleAudioChange} title="Audio Track">
          {audioTracks.length > 0
            ? audioTracks.map((t, i) => (
                <option key={i} value={i}>{t.label}</option>
              ))
            : <option value={0}>Audio: Default</option>}
        </select>
        <select className="subtitle-selector" value={selectedSubtitle} onChange={handleSubtitleChange} title="Subtitles">
          <option value={-1}>Subs: Off</option>
          {subtitleTracks.map((t, i) => (
            <option key={i} value={i}>{t.label}</option>
          ))}
        </select>
      </div>
      <div className="player-controls-right">
        <select className="quality-selector" value={currentQuality} onChange={(e) => handleManualQualityChange(e.target.value)}>
          {QUALITY_PRESETS.map(q => (
            <option key={q} value={q}>{q}</option>
          ))}
        </select>
        <div className="volume-control">
          <button className="mute-btn" onClick={() => setIsMuted(m => !m)} title={isMuted ? 'Unmute' : 'Mute'}>
            {isMuted ? '🔇' : volume > 0.5 ? '🔊' : volume > 0 ? '🔉' : '🔈'}
          </button>
          <input type="range" min="0" max="1" step="0.05" value={volume} onChange={(e) => setVolume(parseFloat(e.target.value))} className="volume-slider" />
        </div>
      </div>
      <ThrowButton onThrow={handleThrow} onReaction={handleReaction} on={on} reactionsEnabled={reactionsEnabled} />
    </div>
  );
}
