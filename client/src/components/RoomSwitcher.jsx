export default function RoomSwitcher({ currentRoom, onSwitch }) {
  return (
    <div className="room-switcher">
      <button
        className={`room-btn ${currentRoom === 'movie' ? 'active' : ''}`}
        onClick={() => onSwitch('movie')}
      >
        🎬 Movies
      </button>
      <button
        className={`room-btn ${currentRoom === 'dj' ? 'active' : ''}`}
        onClick={() => onSwitch('dj')}
      >
        🎵 DJ
      </button>
    </div>
  );
}
