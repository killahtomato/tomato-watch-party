export default function ViewerPanel({ viewers, count, onClose }) {
  return (
    <div className="mobile-slide-overlay" onClick={onClose}>
      <div className="mobile-slide-panel" onClick={(e) => e.stopPropagation()}>
        <div className="mobile-slide-header">
          <h3>Viewers ({count})</h3>
          <button className="mobile-slide-close" onClick={onClose}>✕</button>
        </div>
        <div className="mobile-slide-list">
          {viewers.length === 0 && <p className="mobile-empty">No viewers yet</p>}
          {viewers.map(v => (
            <div key={v.id} className="mobile-viewer-row">
              <span className="mobile-viewer-name">{v.name}</span>
              {v.isHost && <span className="mobile-viewer-crown" title="Host">👑</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
