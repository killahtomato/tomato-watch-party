import MobileSlidePanel from './MobileSlidePanel.jsx';

export default function ViewerPanel({ viewers, count, open, onClose }) {
  return (
    <MobileSlidePanel open={open} onClose={onClose} title={`Viewers (${count})`}>
      <div className="mobile-slide-list">
        {viewers.length === 0 && <p className="mobile-empty">No viewers yet</p>}
        {viewers.map(v => (
          <div key={v.id} className="mobile-viewer-row">
            <span className="mobile-viewer-name">{v.name}</span>
            {v.isHost && <span className="mobile-viewer-crown" title="Host">👑</span>}
          </div>
        ))}
      </div>
    </MobileSlidePanel>
  );
}
