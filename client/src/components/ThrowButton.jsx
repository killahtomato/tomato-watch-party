import { useState, useCallback } from 'react';

export default function ThrowButton({ onThrow }) {
  const [cooldown, setCooldown] = useState(false);

  const handleThrow = useCallback(
    (item) => {
      if (cooldown) return;
      setCooldown(true);
      onThrow(item);
      setTimeout(() => setCooldown(false), 1200);
    },
    [cooldown, onThrow]
  );

  return (
    <div className="throw-controls">
      <button
        className="throw-btn tomato"
        onClick={() => handleThrow('tomato')}
        disabled={cooldown}
        title="Throw a tomato!"
      >
        🍅 Tomato
      </button>
      <button
        className="throw-btn popcorn"
        onClick={() => handleThrow('popcorn')}
        disabled={cooldown}
        title="Throw some popcorn!"
      >
        🍿 Popcorn
      </button>
    </div>
  );
}
