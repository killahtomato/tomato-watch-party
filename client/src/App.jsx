import { useState, useCallback, useEffect, useRef } from 'react';
import { useSocket } from './hooks/useSocket.js';
import NameEntry from './components/NameEntry.jsx';
import VideoPlayer from './components/VideoPlayer.jsx';
import Chat from './components/Chat.jsx';
import HostControls from './components/HostControls.jsx';
import DJRoom from './components/DJRoom.jsx';
import RoomSwitcher from './components/RoomSwitcher.jsx';

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
  const seekRef = useRef(null);
  const playRef = useRef(null);
  const pauseRef = useRef(null);
  const djSeekRef = useRef(null);
  const djPlayRef = useRef(null);
  const djPauseRef = useRef(null);
  const [djPlaybackPercent, setDJPlaybackPercent] = useState(0);

  const handleSeekPercent = useCallback((pct) => {
    setPlaybackPercent(pct);
  }, []);

  useEffect(() => {
    const token = sessionStorage.getItem('hostToken');
    if (token) {
      emit('host:authenticate', { token }, (response) => {
        if (response?.success) {
          setIsHost(true);
        } else {
          sessionStorage.removeItem('hostToken');
        }
      });
    }

    const djToken = sessionStorage.getItem('djToken');
    if (djToken) {
      emit('host:authenticate', { token: djToken, room: 'dj' }, (response) => {
        if (response?.success) {
          setIsDJ(true);
        } else {
          sessionStorage.removeItem('djToken');
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
    });

    const unsubViewerCount = on('viewerCount', (count) => {
      setViewerCount(count);
    });

    const unsubRevoked = on('host:revoked', () => {
      setIsHost(false);
      setIsDJ(false);
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

    return () => {
      unsubJoined?.();
      unsubViewerCount?.();
      unsubRevoked?.();
      unsubJoinError?.();
      unsubUsersList?.();
      unsubPlayback?.();
    };
  }, [on, emit]);

  const handleNameSubmit = useCallback(
    (name) => {
      if (joining) return;
      setJoining(true);
      pendingNameRef.current = name;
      emit('join', { name });
    },
    [emit, joining]
  );

  const handleRoomSwitch = useCallback((room) => {
    if (room === currentRoom) return;
    setCurrentRoom(room);
    emit('join', { name: pendingNameRef.current, room });
  }, [currentRoom, emit]);

  const handleHostLogin = useCallback(
    (token) => {
      sessionStorage.setItem('hostToken', token);
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
      <RoomSwitcher currentRoom={currentRoom} onSwitch={handleRoomSwitch} />

      <div className="main-area">
        <div className={`room-pane movie-pane ${currentRoom === 'movie' ? 'active' : 'inactive'}`}>
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
          />
          {isHost && (
            <HostControls
              emit={emit}
              on={on}
              playbackPercent={playbackPercent}
              seekRef={seekRef}
              playRef={playRef}
              pauseRef={pauseRef}
              onSeekPercent={handleSeekPercent}
            />
          )}
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
          />
        </div>
      </div>

      <div className="sidebar">
        {currentRoom === 'movie' && sessionData?.playbackState?.movie && (
          <div className="now-playing-banner">
            <strong>{sessionData.playbackState.movie.replace(/\.[^.]+$/, '')}</strong>
          </div>
        )}
        {currentRoom === 'dj' && (
          <div className="now-playing-banner">
            <strong>🎵 DJ Room</strong>
          </div>
        )}
        <Chat userName={userName} emit={emit} on={on} sessionData={sessionData} />

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

      <div className={`viewer-panel-tab${viewerPanelOpen ? ' open' : ''}`} onClick={() => setViewerPanelOpen(o => !o)}>
        👥
      </div>

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
                <span className={`viewer-dot ${status}`}></span>
                <span className="viewer-signal">{signal}</span>
                {v.pingMs > 0 && <span className="viewer-ping">{v.pingMs}ms</span>}
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
