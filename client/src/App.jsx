import { useState, useCallback, useEffect, useRef } from 'react';
import { useSocket } from './hooks/useSocket.js';
import NameEntry from './components/NameEntry.jsx';
import VideoPlayer from './components/VideoPlayer.jsx';
import Chat from './components/Chat.jsx';
import HostControls from './components/HostControls.jsx';
import WebPlayer from './components/WebPlayer.jsx';
import WebHostControls from './components/WebHostControls.jsx';
import WebSearchPanel from './components/WebSearchPanel.jsx';
import DJRoom from './components/DJRoom.jsx';
import RoomSwitcher from './components/RoomSwitcher.jsx';
import SettingsPanel from './components/SettingsPanel.jsx';
import { initSettings } from './utils/settings.js';
import { useSettings } from './hooks/useSettings.js';
import { useChatHistory } from './hooks/useChatHistory.js';
import { applyOrder } from './utils/order.js';

export default function App() {
  const [userName, setUserName] = useState(null);
  const [isHost, setIsHost] = useState(false);
  const [isDJ, setIsDJ] = useState(false);
  const [currentRoom, setCurrentRoom] = useState('movie');
  const [viewerCount, setViewerCount] = useState(0);
  const [sessionData, setSessionData] = useState(null);
  const [joining, setJoining] = useState(false);
  const [playbackPercent, setPlaybackPercent] = useState(0);
  const [joinError, setJoinError] = useState(null);
  const [errorKey, setErrorKey] = useState(0);
  const [viewerPanelOpen, setViewerPanelOpen] = useState(false);
  const [viewers, setViewers] = useState([]);
  const { connected, emit, on } = useSocket();
  const pendingNameRef = useRef(null);
  const lastJoinRef = useRef(null);
  const hostTokenRef = useRef(null);
  const djTokenRef = useRef(null);
  const wasConnectedRef = useRef(false);
  const seekRef = useRef(null);
  const playRef = useRef(null);
  const pauseRef = useRef(null);
  const djSeekRef = useRef(null);
  const djPlayRef = useRef(null);
  const djPauseRef = useRef(null);
  const [djPlaybackPercent, setDJPlaybackPercent] = useState(0);
  const [movies, setMovies] = useState([]);
  const [webState, setWebState] = useState(null);
  const [webProgress, setWebProgress] = useState({ current: 0, duration: 0, live: false });
  const [webPanelOpen, setWebPanelOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [resumeOnStart, setResumeOnStart] = useState(true);
  const [restoredAt, setRestoredAt] = useState(null);
  const settings = useSettings();
  const { messages: chatMessages, sendMessage: sendChatMessage } = useChatHistory({
    on,
    initialHistory: sessionData?.chatHistory,
  });

  useEffect(() => {
    initSettings();
  }, []);

  const handleSeekPercent = useCallback((pct) => {
    setPlaybackPercent(pct);
  }, []);

  useEffect(() => {
    const token = sessionStorage.getItem('hostToken');
    if (token) {
      hostTokenRef.current = token;
      emit('host:authenticate', { token }, (response) => {
        if (response?.success) {
          setIsHost(true);
        } else {
          sessionStorage.removeItem('hostToken');
          hostTokenRef.current = null;
        }
      });
    }

    const djToken = sessionStorage.getItem('djToken');
    if (djToken) {
      djTokenRef.current = djToken;
      emit('host:authenticate', { token: djToken, room: 'dj' }, (response) => {
        if (response?.success) {
          setIsDJ(true);
        } else {
          sessionStorage.removeItem('djToken');
          djTokenRef.current = null;
        }
      });
    }

    const unsubJoined = on('joined', (data) => {
      setSessionData(data);
      setViewerCount(data.viewerCount);
      setUserName(pendingNameRef.current);
      setJoining(false);
      setJoinError(null);
      if (data.room) setCurrentRoom(data.room);
      if (data.webState) setWebState(data.webState);
      if (data.resumePolicy) setResumeOnStart(data.resumePolicy.resumeOnStart);
      if (data.restoredAt) setRestoredAt(data.restoredAt);
    });
    const unsubResumePolicy = on('resumePolicy', (policy) => {
      if (policy?.resumeOnStart !== undefined) setResumeOnStart(Boolean(policy.resumeOnStart));
    });

    const unsubViewerCount = on('viewerCount', (count) => {
      setViewerCount(count);
    });

    const unsubRevoked = on('host:revoked', () => {
      setIsHost(false);
      setIsDJ(false);
      hostTokenRef.current = null;
      djTokenRef.current = null;
      sessionStorage.removeItem('hostToken');
      sessionStorage.removeItem('djToken');
    });

    const unsubJoinError = on('join:error', (data) => {
      setJoining(false);
      setJoinError(data?.error || 'Name already taken');
      setErrorKey(k => k + 1);
    });

    const unsubUsersList = on('users:list', (data) => {
      setViewers(data);
    });

    const unsubPlayback = on('playbackUpdate', (state) => {
      setSessionData(prev => ({ ...prev, playbackState: state }));
    });

    const unsubWeb = on('web:playbackUpdate', (state) => {
      setWebState(state);
    });

    return () => {
      unsubJoined?.();
      unsubViewerCount?.();
      unsubRevoked?.();
      unsubJoinError?.();
      unsubUsersList?.();
      unsubPlayback?.();
      unsubWeb?.();
      unsubResumePolicy?.();
    };
  }, [on, emit]);

  useEffect(() => {
    if (!connected) {
      wasConnectedRef.current = false;
      return undefined;
    }
    if (wasConnectedRef.current) return undefined;
    wasConnectedRef.current = true;
    if (!lastJoinRef.current) return undefined;
    emit('join', lastJoinRef.current);
    if (hostTokenRef.current) emit('host:authenticate', { token: hostTokenRef.current }, () => {});
    if (djTokenRef.current) emit('host:authenticate', { token: djTokenRef.current, room: 'dj' }, () => {});
    return undefined;
  }, [connected, emit]);

  const handleNameSubmit = useCallback(
    (name) => {
      if (joining) return;
      setJoining(true);
      pendingNameRef.current = name;
      lastJoinRef.current = { name };
      emit('join', { name });
    },
    [emit, joining]
  );

  const handleRoomSwitch = useCallback((room) => {
    if (room === currentRoom) return;
    setCurrentRoom(room);
    lastJoinRef.current = { name: pendingNameRef.current, room };
    emit('join', { name: pendingNameRef.current, room });
  }, [currentRoom, emit]);

  const handleHostLogin = useCallback(
    (token) => {
      sessionStorage.setItem('hostToken', token);
      hostTokenRef.current = token;
      emit('host:authenticate', { token }, (response) => {
        if (response?.success) {
          setIsHost(true);
        } else {
          sessionStorage.removeItem('hostToken');
          alert('Invalid host token');
        }
      });
    },
    [emit]
  );

  const handleDJLogin = useCallback(
    (token) => {
      sessionStorage.setItem('djToken', token);
      djTokenRef.current = token;
      emit('host:authenticate', { token, room: 'dj' }, (response) => {
        if (response?.success) {
          setIsDJ(true);
        } else {
          sessionStorage.removeItem('djToken');
          alert('Invalid DJ token');
        }
      });
    },
    [emit]
  );

  const handleForceQuality = useCallback(
    (userId, quality) => {
      if (userId) {
        emit('host:forceQuality', { targetUserId: userId, quality });
      } else {
        emit('host:forceQuality', { quality });
      }
    },
    [emit]
  );

  const loadMovies = useCallback(async () => {
    const [list, orderData] = await Promise.all([
      fetch('/api/movies').then(r => r.json()).catch(() => []),
      fetch('/api/order/movie').then(r => r.json()).catch(() => ({ order: [] })),
    ]);
    const movieList = Array.isArray(list) ? list : [];
    const savedOrder = Array.isArray(orderData?.order) ? orderData.order : [];
    setMovies(applyOrder(movieList, savedOrder));
  }, []);

  const handleReorderMovies = useCallback((nextMovies) => {
    setMovies(nextMovies);
    emit('movie:setOrder', { order: nextMovies.map(m => m.name) }, (res) => {
      if (res?.error) console.error(res.error);
    });
  }, [emit]);

  const handleWebPlay = useCallback((descriptor) => {
    emit('web:play', descriptor, (res) => {
      if (res?.error) alert(res.error);
    });
    setWebPanelOpen(false);
  }, [emit]);

  const handleResumePolicyChange = useCallback((value) => {
    setResumeOnStart(value);
    emit('host:setResumePolicy', { value }, (res) => {
      if (res?.error) console.error(res.error);
    });
  }, [emit]);

  useEffect(() => {
    loadMovies();
    const unsubUpdated = on('movies:updated', loadMovies);
    const unsubOrder = on('orderUpdate', (data) => {
      if (data?.room === 'movie') {
        setMovies(prev => applyOrder(prev, Array.isArray(data.order) ? data.order : []));
      }
    });
    return () => {
      unsubUpdated?.();
      unsubOrder?.();
    };
  }, [loadMovies, on]);

  const getSignalBars = (pingMs) => {
    if (pingMs <= 0) return '░░░░';
    if (pingMs < 50) return '▓▓▓▓';
    if (pingMs < 100) return '▓▓▓░';
    if (pingMs < 200) return '▓▓░░';
    return '▓░░░';
  };

  const getHealthStatus = (bufferHealth) => {
    if (!bufferHealth && bufferHealth !== 0) return 'unknown';
    if (bufferHealth > 10) return 'good';
    if (bufferHealth > 5) return 'low';
    return 'critical';
  };

  if (!userName || joining) {
    return (
      <NameEntry
        onSubmit={handleNameSubmit}
        connected={connected}
        joining={joining}
        error={joinError}
        onErrorClear={() => setJoinError(null)}
        errorKey={errorKey}
      />
    );
  }

  return (
    <div className="app">
      <div className="main-area">
        <RoomSwitcher currentRoom={currentRoom} onSwitch={handleRoomSwitch} />

        <div className="room-panes">
        <div className={`room-pane movie-pane ${currentRoom === 'movie' ? 'active' : 'inactive'}`}>
          {webState?.web ? (
            <WebPlayer
              userId={sessionData?.userId}
              isHost={isHost}
              emit={emit}
              on={on}
              webState={webState}
              seekRef={seekRef}
              playRef={playRef}
              pauseRef={pauseRef}
              isActive={currentRoom === 'movie'}
              onProgress={setWebProgress}
            />
          ) : (
            <VideoPlayer
              userName={userName}
              isHost={isHost}
              emit={emit}
              on={on}
              sessionData={sessionData}
              onTimeUpdate={setPlaybackPercent}
              seekRef={seekRef}
              playRef={playRef}
              pauseRef={pauseRef}
              isActive={currentRoom === 'movie'}
              movies={movies}
            />
          )}
          {isHost && (webState?.web ? (
            <WebHostControls
              emit={emit}
              webState={webState}
              seekRef={seekRef}
              playRef={playRef}
              pauseRef={pauseRef}
              progress={webProgress}
              movies={movies}
              onReorderMovies={handleReorderMovies}
              webPanelOpen={webPanelOpen}
              setWebPanelOpen={setWebPanelOpen}
              resumeOnStart={resumeOnStart}
              onResumePolicyChange={handleResumePolicyChange}
              restoredAt={restoredAt}
            />
          ) : (
            <HostControls
              emit={emit}
              on={on}
              playbackPercent={playbackPercent}
              seekRef={seekRef}
              playRef={playRef}
              pauseRef={pauseRef}
              onSeekPercent={handleSeekPercent}
              movies={movies}
              onReorderMovies={handleReorderMovies}
              webPanelOpen={webPanelOpen}
              setWebPanelOpen={setWebPanelOpen}
              resumeOnStart={resumeOnStart}
              onResumePolicyChange={handleResumePolicyChange}
              restoredAt={restoredAt}
            />
          ))}
        </div>
        <div className={`room-pane dj-pane ${currentRoom === 'dj' ? 'active' : 'inactive'}`}>
          <DJRoom
            emit={emit}
            on={on}
            sessionData={sessionData}
            isDJ={isDJ}
            onDJLogin={handleDJLogin}
            isActive={currentRoom === 'dj'}
            seekRef={djSeekRef}
            playRef={djPlayRef}
            pauseRef={djPauseRef}
            onSeekPercent={setDJPlaybackPercent}
            onPercentUpdate={setDJPlaybackPercent}
            playbackPercent={djPlaybackPercent}
            resumeOnStart={resumeOnStart}
            onResumePolicyChange={handleResumePolicyChange}
            restoredAt={restoredAt}
          />
        </div>
        </div>
      </div>

      {isHost && (
        <div className={`movie-panel web-panel${webPanelOpen && currentRoom === 'movie' ? ' open' : ''}`}>
          <div className="movie-panel-header">
            <h4>Web Search</h4>
            <div className="movie-panel-actions">
              <button className="movie-panel-close" onClick={() => setWebPanelOpen(false)}>✕</button>
            </div>
          </div>
          <WebSearchPanel emit={emit} on={on} isHost onPlay={handleWebPlay} />
        </div>
      )}

      <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />

      <div className="sidebar">
        {currentRoom === 'movie' && webState?.web && (
          <div className="now-playing-banner">
            <strong>{webState.web.title}</strong>
          </div>
        )}
        {currentRoom === 'movie' && !webState?.web && sessionData?.playbackState?.movie && (
          <div className="now-playing-banner">
            <strong>{sessionData.playbackState.movie.replace(/\.[^.]+$/, '')}</strong>
          </div>
        )}
        {currentRoom === 'dj' && (
          <div className="now-playing-banner">
            <strong>🎵 DJ Room</strong>
          </div>
        )}
        <Chat
          userName={userName}
          messages={chatMessages}
          onSend={(text) => sendChatMessage(text, emit)}
        />

        {currentRoom === 'movie' && !isHost && (
          <button
            className="host-login-btn"
            onClick={() => {
              const password = prompt('Enter host password:');
              if (!password) return;
              fetch('/api/host/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password }),
              })
                .then((r) => r.json())
                .then((data) => {
                  if (data.token) handleHostLogin(data.token);
                  else alert('Login failed');
                });
            }}
          >
            Host Login
          </button>
        )}

        {currentRoom === 'dj' && !isDJ && (
          <button
            className="host-login-btn"
            onClick={() => {
              const password = prompt('Enter DJ password:');
              if (!password) return;
              fetch('/api/dj/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password }),
              })
                .then((r) => r.json())
                .then((data) => {
                  if (data.token) handleDJLogin(data.token);
                  else alert('Login failed');
                });
            }}
          >
            DJ Login
          </button>
        )}
      </div>

      <div
        className={`settings-panel-tab${settingsOpen ? ' open' : ''}`}
        onClick={() => setSettingsOpen((o) => !o)}
        title="Settings"
        aria-label="Settings"
      >
        ⚙️
      </div>

      <div className={`viewer-panel-tab${viewerPanelOpen ? ' open' : ''}`} onClick={() => setViewerPanelOpen(o => !o)}>
        👥
      </div>

      <a className="mobile-site-link" href="/m">Mobile site</a>

      <div className={`viewer-panel${viewerPanelOpen ? ' open' : ''}`}>
        <div className="viewer-panel-header">
          <span>👥 {viewerCount} viewer{viewerCount !== 1 ? 's' : ''}</span>
          <button className="viewer-panel-close" onClick={() => setViewerPanelOpen(false)}>✕</button>
        </div>
        <div className="viewer-panel-list">
          {viewers.map((v) => {
            const status = getHealthStatus(v.bufferHealth);
            const signal = getSignalBars(v.pingMs);
            return (
              <div key={v.id} className="viewer-item">
                {settings.showHealth && <span className={`viewer-dot ${status}`}></span>}
                {settings.showHealth && <span className="viewer-signal">{signal}</span>}
                {settings.showHealth && v.pingMs > 0 && <span className="viewer-ping">{v.pingMs}ms</span>}
                <span className="viewer-name">{v.name}</span>
                {v.isHost && <span className="viewer-host-icon">👑</span>}
                {isHost && currentRoom === 'movie' && (
                  <div className="viewer-force-quality">
                    <button
                      className="force-quality-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        const popup = e.target.nextElementSibling;
                        popup.classList.toggle('open');
                      }}
                    >
                      ⚙️
                    </button>
                    <div className="force-quality-popup">
                      {['1080p', '720p', '480p'].map(q => (
                        <button
                          key={q}
                          className="fq-option"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleForceQuality(v.id, q);
                            e.target.closest('.force-quality-popup').classList.remove('open');
                          }}
                        >
                          {q}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
