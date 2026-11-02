import { useState, useRef, useCallback, useEffect } from 'react';

export default function NameEntry({ onSubmit, connected, joining, error, onErrorClear, errorKey }) {
  const [name, setName] = useState('');
  const [fallingChars, setFallingChars] = useState([]);
  const [shaking, setShaking] = useState(false);
  const prevErrorKey = useRef(errorKey);

  const triggerFallOut = useCallback((text) => {
    const chars = text.split('').map((char, i) => ({
      char: char === ' ' ? ' ' : char,
      id: `${Date.now()}-${i}`,
      delay: Math.random() * 60,
      drift: (Math.random() - 0.5) * 30,
      leftPct: (i / Math.max(text.length, 1)) * 100,
    }));
    setFallingChars(chars);
    setShaking(true);

    setTimeout(() => {
      setShaking(false);
      setFallingChars([]);
    }, 700);

    setName('');
  }, []);

  useEffect(() => {
    if (errorKey !== prevErrorKey.current) {
      prevErrorKey.current = errorKey;
      if (error && name) {
        triggerFallOut(name);
      }
    }
  }, [errorKey, error, name, triggerFallOut]);

  const handleSubmit = (e) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (trimmed) onSubmit(trimmed);
  };

  const handleChange = (e) => {
    setName(e.target.value);
    onErrorClear?.();
  };

  return (
    <div className="name-entry">
      <div className="name-entry-box">
        <h1>🍅Tomato Watch Party🍅</h1>
        <p className="subtitle">Join the audience</p>

        {!connected && <p className="conn-status offline">Connecting to server...</p>}
        {connected && !joining && !error && <p className="conn-status online">Connected</p>}
        {joining && <p className="conn-status joining">Joining...</p>}

        <form onSubmit={handleSubmit}>
          <div className="name-input-wrap">
            <input
              type="text"
              value={name}
              onChange={handleChange}
              placeholder="Your display name"
              maxLength={24}
              disabled={joining}
              autoFocus
              className={shaking ? 'shake' : ''}
            />
            {fallingChars.length > 0 && (
              <div className="falling-chars">
                {fallingChars.map((c) => (
                  <span
                    key={c.id}
                    className="falling-char"
                    style={{
                      animationDelay: `${c.delay}ms`,
                      '--drift': `${c.drift}px`,
                      left: `${c.leftPct}%`,
                    }}
                  >
                    {c.char}
                  </span>
                ))}
              </div>
            )}
          </div>
          {error && shaking && <p className="name-error">{error}</p>}
          <button type="submit" disabled={!name.trim() || !connected || joining}>
            {joining ? '...' : 'Join'}
          </button>
        </form>
      </div>
    </div>
  );
}
