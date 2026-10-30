import { useState, useEffect, useRef } from 'react';

export default function Chat({ userName, emit, on, sessionData }) {
  const [messages, setMessages] = useState(() => {
    const initial = sessionData?.chatHistory || [];
    const now = Date.now();
    initial.forEach(msg => {
      if (msg.type === 'system') {
        const age = now - msg.timestamp;
        if (age < 3500) {
          setTimeout(() => {
            setMessages(prev => prev.filter(m => m.id !== msg.id));
          }, 3500 - age);
        }
      }
    });
    return initial.filter(msg => msg.type !== 'system' || (now - msg.timestamp) < 3500);
  });
  const [input, setInput] = useState('');
  const scrollRef = useRef(null);

  useEffect(() => {
    if (!on) return;
    const unsubMsg = on('chat:message', (msg) => {
      setMessages((prev) => [...prev.slice(-199), msg]);
    });

    const unsubSys = on('chat:system', (msg) => {
      setMessages((prev) => [...prev.slice(-199), msg]);
      setTimeout(() => {
        setMessages((prev) => prev.filter(m => m.id !== msg.id));
      }, 3500);
    });

    return () => {
      unsubMsg?.();
      unsubSys?.();
    };
  }, [on]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = (e) => {
    e.preventDefault();
    const text = input.trim();
    if (!text) return;
    emit('chat:message', { text });
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
    if (text.includes('joined')) return '🎬';
    if (text.includes('left')) return '👋';
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
        />
        <button type="submit" disabled={!input.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}
