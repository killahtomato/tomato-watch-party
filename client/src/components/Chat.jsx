import { useState, useEffect, useRef } from 'react';

export default function Chat({ userName, messages, onSend }) {
  const [input, setInput] = useState('');
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = (e) => {
    e.preventDefault();
    onSend(input);
    setInput('');
  };

  const formatTime = (ts) => {
    const d = new Date(ts);
    let h = d.getHours();
    const m = d.getMinutes();
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return `${h}:${m.toString().padStart(2, '0')} ${ampm}`;
  };

  const getSystemIcon = (text) => {
    if (text.includes('DJ') && text.includes('joined')) return '\u{1FAA9}';
    if (text.includes('DJ') && text.includes('left')) return '\u{1F44B}';
    if (text.includes('joined')) return '\u{1F3AC}';
    if (text.includes('left')) return '\u{1F44B}';
    return '';
  };

  return (
    <div className="chat">
      <div className="chat-messages" ref={scrollRef}>
        {messages.length === 0 && <p className="chat-empty">No messages yet. Say hi!</p>}
        {messages.map((msg) => {
          const isSystem = msg.type === 'system';
          const isSelf = msg.name && msg.name.toLowerCase() === userName?.toLowerCase();
          return (
            <div
              key={msg.id}
              className={`chat-msg${isSystem ? ' system' : ''}${isSelf && !isSystem ? ' self' : ''}`}
            >
              {isSystem ? (
                <span className="chat-system-text">
                  {getSystemIcon(msg.text)} {msg.text}
                </span>
              ) : (
                <>
                  <div className="chat-msg-header">
                    {msg.isHost && <span className="chat-host-crown">👑</span>}
                    <span className="chat-name">{msg.name}</span>
                    <span className="chat-timestamp">{formatTime(msg.timestamp)}</span>
                  </div>
                  <span className="chat-text">{msg.text}</span>
                </>
              )}
            </div>
          );
        })}
      </div>

      <form className="chat-input" onSubmit={handleSend}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type a message..."
          maxLength={500}
          enterKeyHint="send"
        />
        <button type="submit" disabled={!input.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}
