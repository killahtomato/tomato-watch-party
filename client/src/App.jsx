import { useState, useCallback, useEffect, useRef } from 'react';
import { useSocket } from './hooks/useSocket.js';
import NameEntry from './components/NameEntry.jsx';
import VideoPlayer from './components/VideoPlayer.jsx';
import Chat from './components/Chat.jsx';
import HostControls from './components/HostControls.jsx';

export default function App() {
  const [userName, setUserName] = useState(null);
  const [isHost, setIsHost] = useState(false);
  const [viewerCount, setViewerCount] = useState(0);
  const [sessionData, setSessionData] = useState(null);
  const [joining, setJoining] = useState(false);
  const [displayTime, setDisplayTime] = useState(0);
  const seekRef = useRef(null);
  const playRef = useRef(null);
  const pauseRef = useRef(null);
  const { connected, emit, on } = useSocket();

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

    const unsubJoined = on('joined', (data) => {
      setSessionData(data);
      setViewerCount(data.viewerCount);
      setJoining(false);
    });

    const unsubViewerCount = on('viewerCount', (count) => {
      setViewerCount(count);
    });

    const unsubRevoked = on('host:revoked', () => {
      setIsHost(false);
      sessionStorage.removeItem('hostToken');
    });

    return () => {
      unsubJoined?.();
      unsubViewerCount?.();
      unsubRevoked?.();
    };
  }, [on, emit]);

  const handleNameSubmit = useCallback(
    (name) => {
      if (joining) return;
      setJoining(true);
      setUserName(name);
      emit('join', { name });
    },
    [emit, joining]
  );

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

  if (!userName || joining) {
    return <NameEntry onSubmit={handleNameSubmit} connected={connected} joining={joining} />;
  }

  return (
    <div className="app">
      <div className="main-area">
        <VideoPlayer
          userName={userName}
          isHost={isHost}
          emit={emit}
          on={on}
          sessionData={sessionData}
          onTimeUpdate={setDisplayTime}
          seekRef={seekRef}
          playRef={playRef}
          pauseRef={pauseRef}
        />
        {isHost && <HostControls emit={emit} on={on} currentTime={displayTime} seekRef={seekRef} playRef={playRef} pauseRef={pauseRef} />}
      </div>
      <div className="sidebar">
        <div className="viewer-count">
          <span className="dot"></span> {viewerCount} viewer{viewerCount !== 1 ? 's' : ''}
        </div>
        <Chat userName={userName} emit={emit} on={on} sessionData={sessionData} />
        {!isHost && (
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
      </div>
    </div>
  );
}
