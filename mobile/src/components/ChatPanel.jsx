import Chat from '@client/components/Chat.jsx';
import MobileSlidePanel from './MobileSlidePanel.jsx';

export default function ChatPanel({ open, onClose, ...props }) {
  return (
    <MobileSlidePanel open={open} onClose={onClose} title="Chat" className="mobile-chat-slide">
      <div className="mobile-chat-body">
        <Chat {...props} />
      </div>
    </MobileSlidePanel>
  );
}
