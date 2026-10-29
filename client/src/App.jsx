import { useState, useCallback } from 'react';
import { useSocket } from './hooks/useSocket.js';
import NameEntry from './components/NameEntry.jsx';
import VideoPlayer from './components/VideoPlayer.jsx';
import Chat from './components/Chat.jsx';
import HostControls from './components/HostControls.jsx';

export default function App() {
  const [userName, setUserName] = useState(null);
  const [isHost, setIsHost] = useState(false);
  const [viewerCount, setViewerCount] = useState(0);
  const { connected, emit, on } = useSocket();

  const handleNameSubmit = useCallback(
    (name) => {
      setUserName(name);
      emit('join', { name });

      on('viewerCount', (count) => setViewerCount(count));
    },
    [emit, on]
  );

  const handleHostLogin = useCallback(
    (token) => {
      emit('host:authenticate', { token }, (response) => {
        if (response?.success) {
          setIsHost(true);
        } else {
          alert('Invalid host token');
        }
      });
    },
    [emit]
  );

  if (!userName) {
    return <NameEntry onsubmit={handleNameSubmit} connected={connected} />;
  }

  return (
    <div className="app">
      <div className="main-area">
        <VideoPlayer userName={userName} isHost={isHost} emit={emit} on={on} />
        {isHost && <HostControls emit={emit} on={on} />}
      </div>
      <div className="sidebar">
        <div className="viewer-count">
          <span className="dot"></span> {viewerCount} viewer{viewerCount !== 1 ? 's' : ''}
        </div>
        <Chat userName={userName} emit={emit} on={on} />
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
