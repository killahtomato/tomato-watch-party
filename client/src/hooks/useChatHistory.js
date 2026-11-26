import { useCallback, useEffect, useRef, useState } from 'react';

const MAX_MESSAGES = 200;
const SYSTEM_TTL_MS = 3500;

function seedMessages(initial) {
  const list = Array.isArray(initial) ? initial : [];
  const timers = {};
  const now = Date.now();
  const visible = list.filter((msg) => {
    if (!msg || msg.type !== 'system') return true;
    return now - Number(msg.timestamp || 0) < SYSTEM_TTL_MS;
  });
  for (const msg of visible) {
    if (msg.type === 'system') {
      const remaining = SYSTEM_TTL_MS - (now - Number(msg.timestamp || 0));
      timers[msg.id] = setTimeout(() => removeMessage(msg.id), Math.max(0, remaining));
    }
  }
  return { messages: visible, timers };
}

function removeMessage(setMessages, timers, id) {
  setMessages((prev) => prev.filter((msg) => msg.id !== id));
  const timer = timers.current[id];
  if (timer) {
    clearTimeout(timer);
    delete timers.current[id];
  }
}

export function useChatHistory({ on, initialHistory } = {}) {
  const seeded = useRef(null);
  if (seeded.current === null) {
    seeded.current = seedMessages(initialHistory).messages;
  }
  const [messages, setMessages] = useState(seeded.current);
  const timers = useRef({});

  useEffect(() => {
    if (!on) return undefined;

    const append = (msg) => {
      setMessages((prev) => [...prev.slice(-(MAX_MESSAGES - 1)), msg]);
    };

    const unsubMessage = on('chat:message', (msg) => append(msg));

    const unsubSystem = on('chat:system', (msg) => {
      append(msg);
      timers.current[msg.id] = setTimeout(() => removeMessage(setMessages, timers, msg.id), SYSTEM_TTL_MS);
    });

    const unsubJoined = on('joined', (data) => {
      const history = Array.isArray(data?.chatHistory) ? data.chatHistory : [];
      Object.values(timers.current).forEach(clearTimeout);
      timers.current = {};
      setMessages(seedMessages(history).messages);
    });

    return () => {
      unsubMessage?.();
      unsubSystem?.();
      unsubJoined?.();
      Object.values(timers.current).forEach(clearTimeout);
      timers.current = {};
    };
  }, [on]);

  const sendMessage = useCallback((text, emit) => {
    const value = String(text ?? '').trim().slice(0, 500);
    if (!value) return;
    emit('chat:message', { text: value });
  }, []);

  return { messages, sendMessage };
}
