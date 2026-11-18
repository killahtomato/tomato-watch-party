export default function TapToStart({ onStart }) {
  return (
    <div className="tap-to-start" onClick={onStart} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onStart()}>
      <div className="tap-to-start-card">
        <span className="tap-to-start-icon">🍅</span>
        <h1>Tomato Watch Party</h1>
        <p>Tap anywhere to start watching</p>
      </div>
    </div>
  );
}
