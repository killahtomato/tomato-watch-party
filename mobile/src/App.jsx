import { useState, useCallback, useEffect, useRef } from 'react';
import { useSocket } from '@client/hooks/useSocket.js';
import NameEntry from '@client/components/NameEntry.jsx';
import TapToStart from './components/TapToStart.jsx';
import ChatPanel from './components/ChatPanel.jsx';
import ViewerPanel from './components/ViewerPanel.jsx';
import ActionBar from './components/ActionBar.jsx';
import MovieRoom from './components/MovieRoom.jsx';
import WebRoom from './components/WebRoom.jsx';
import DJRoom from './components/DJRoom.jsx';
import SettingsPanel from '@client/components/SettingsPanel.jsx';
import { initSettings } from '@client/utils/settings.js';

const ROOM_KEY = 'twp:mobile-room';

export default function App() {
  const { connected, emit, on } = useSocket();
  const [userName, setUserName] = useState(null);
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState(null);
  const [errorKey, setErrorKey] = useState(0);
  const [sessionData, setSessionData] = useState(null);
  const [webState, setWebState] = useState(null);
  const [viewerCount, setViewerCount] = useState(0);
  const [viewers, setViewers] = useState([]);
  const [room, setRoom] = useState(() => (localStorage.getItem(ROOM_KEY) === 'dj' ? 'dj' : 'movie'));
  const [audioUnlocked, setAudioUnlocked] = useState(false);
  const [viewerPanelOpen, setViewerPanelOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatUnread, setChatUnread] = useState(0);
  const [installPrompt, setInstallPrompt] = useState(null);
  const [installDismissed, setInstallDismissed] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const pendingNameRef = useRef(null);
  const lastJoinRef = useRef(null);
  const wasConnectedRef = useRef(false);
  const chatOpenRef = useRef(false);

  useEffect(() => { chatOpenRef.current = chatOpen; }, [chatOpen]);

  useEffect(() => {
    initSettings();
  }, []);

  useEffect(() => {
    if (!connected) {
      wasConnectedRef.current = false;
      return undefined;
    }
    if (wasConnectedRef.current) return undefined;
    wasConnectedRef.current = true;
    if (!lastJoinRef.current) return undefined;
    emit('join', lastJoinRef.current);
    return undefined;
  }, [connected, emit]);

  useEffect(() => {
    const handler = (e) => {
      e.preventDefault();
      setInstallPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstall = useCallback(async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  }, [installPrompt]);

  useEffect(() => {
    const unsubJoined = on('joined', (data) => {
      setSessionData(data);
      setViewerCount(data.viewerCount);
      setUserName(pendingNameRef.current);
      setJoining(false);
      setJoinError(null);
      if (data.room) setRoom(data.room);
      if (data.webState) setWebState(data.webState);
    });
    const unsubViewerCount = on('viewerCount', setViewerCount);
    const unsubUsersList = on('users:list', setViewers);
    const unsubJoinError = on('join:error', (data) => {
      setJoining(false);
      setJoinError(data?.error || 'Name already taken');
      setErrorKey(k => k + 1);
    });
    const unsubChat = on('chat:message', () => {
      if (!chatOpenRef.current) setChatUnread(n => n + 1);
    });
    const unsubWeb = on('web:playbackUpdate', setWebState);
    return () => {
      unsubJoined?.();
      unsubViewerCount?.();
      unsubUsersList?.();
      unsubJoinError?.();
      unsubChat?.();
      unsubWeb?.();
    };
  }, [on]);

  useEffect(() => {
    localStorage.setItem(ROOM_KEY, room);
  }, [room]);

  const handleNameSubmit = useCallback((name) => {
    if (joining) return;
    setJoining(true);
    pendingNameRef.current = name;
    lastJoinRef.current = { name };
    emit('join', { name });
  }, [emit, joining]);

  const handleSwitchRoom = useCallback((nextRoom) => {
    if (nextRoom === room) return;
    setRoom(nextRoom);
    lastJoinRef.current = { name: pendingNameRef.current, room: nextRoom };
    emit('join', { name: pendingNameRef.current, room: nextRoom });
  }, [emit, room]);

  const openChat = useCallback(() => {
    setChatOpen(true);
    setViewerPanelOpen(false);
    setChatUnread(0);
  }, []);

  const openViewers = useCallback(() => {
    setViewerPanelOpen(true);
    setChatOpen(false);
  }, []);

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
    <div className="mobile-app">
      {!audioUnlocked && <TapToStart onStart={() => setAudioUnlocked(true)} />}

      {installPrompt && !installDismissed && (
        <div className="m-install-banner">
          <span>Install Tomato Party for the full-screen app experience.</span>
          <div className="m-install-actions">
            <button onClick={handleInstall}>Install</button>
            <button className="m-install-dismiss" onClick={() => { setInstallDismissed(true); setInstallPrompt(null); }}>✕</button>
          </div>
        </div>
      )}

      <header className="mobile-header">
        <button className="mobile-header-btn" onClick={() => handleSwitchRoom(room === 'movie' ? 'dj' : 'movie')}>
          {room === 'movie' ? '🎵 DJ' : '🎬 Movies'}
        </button>
        <span className="mobile-header-title">{room === 'movie' ? 'Watch Party' : 'DJ Room'}</span>
        <div className="mobile-header-actions">
          <button
            className="mobile-header-btn"
            onClick={() => setSettingsOpen(true)}
            title="Settings"
            aria-label="Settings"
          >
            ⚙️
          </button>
          <button
            className="mobile-header-btn"
            onClick={() => { window.location.href = '/?desktop=1'; }}
            title="Switch to desktop site"
          >
            🖥
          </button>
          <button className="mobile-header-btn mobile-chat-btn" onClick={openChat} title="Chat">
            💬{chatUnread > 0 && <span className="mobile-badge">{chatUnread > 9 ? '9+' : chatUnread}</span>}
          </button>
          <button className="mobile-header-btn" onClick={openViewers} title="Viewers">
            👥 {viewerCount}
          </button>
        </div>
      </header>

      <main className="mobile-main">
        <div className={`mobile-room-pane ${room === 'movie' ? 'active' : 'inactive'}`}>
          {webState?.web ? (
            <WebRoom
              webState={webState}
              emit={emit}
              on={on}
              userId={sessionData?.userId}
              unlocked={audioUnlocked}
              isActive={room === 'movie'}
            />
          ) : (
            <MovieRoom emit={emit} on={on} sessionData={sessionData} userName={userName} unlocked={audioUnlocked} isActive={room === 'movie'} />
          )}
        </div>
        <div className={`mobile-room-pane ${room === 'dj' ? 'active' : 'inactive'}`}>
          <DJRoom emit={emit} on={on} sessionData={sessionData} userName={userName} unlocked={audioUnlocked} isActive={room === 'dj'} />
        </div>
      </main>

      <ActionBar room={room} on={on} emit={emit} />

      <ChatPanel
        open={chatOpen}
        userName={userName}
        emit={emit}
        on={on}
        sessionData={sessionData}
        onClose={() => setChatOpen(false)}
      />

      <ViewerPanel
        open={viewerPanelOpen}
        viewers={viewers}
        count={viewerCount}
        onClose={() => setViewerPanelOpen(false)}
      />

      <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
