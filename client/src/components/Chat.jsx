import { useState, useEffect, useRef } from 'react';

export default function Chat({ userName, emit, on, sessionData }) {
  const [messages, setMessages] = useState(sessionData?.chatHistory || []);
  const [input, setInput] = useState('');
  const scrollRef = useRef(null);

  useEffect(() => {
    const unsub = on('chat:message', (msg) => {
      setMessages((prev) => [...prev.slice(-199), msg]);
    });

    return () => {
      unsub?.();
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

  return (
    <div className="chat">
      <div className="chat-messages" ref={scrollRef}>
        {messages.length === 0 && <p className="chat-empty">No messages yet. Say hi!</p>}
        {messages.map((msg) => (
          <div key={msg.id} className="chat-msg">
            <span className="chat-name">{msg.name}</span>
            <span className="chat-text">{msg.text}</span>
          </div>
        ))}
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
