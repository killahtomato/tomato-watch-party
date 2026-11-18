import Chat from '@client/components/Chat.jsx';

export default function ChatPanel({ onClose, ...props }) {
  return (
    <div className="mobile-slide-overlay" onClick={onClose}>
      <div className="mobile-slide-panel mobile-chat-slide" onClick={(e) => e.stopPropagation()}>
        <div className="mobile-slide-header">
          <h3>Chat</h3>
          <button className="mobile-slide-close" onClick={onClose}>✕</button>
        </div>
        <div className="mobile-chat-body">
          <Chat {...props} />
        </div>
      </div>
    </div>
  );
}
