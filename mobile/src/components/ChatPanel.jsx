import Chat from '@client/components/Chat.jsx';
import MobileSlidePanel from './MobileSlidePanel.jsx';

export default function ChatPanel({ open, onClose, messages, onSend, userName }) {
  return (
    <MobileSlidePanel open={open} onClose={onClose} title="Chat" className="mobile-chat-slide">
      <div className="mobile-chat-body">
        <Chat userName={userName} messages={messages} onSend={onSend} />
      </div>
    </MobileSlidePanel>
  );
}
