import { useState, useCallback, useEffect } from 'react';

export default function ThrowButton({ onThrow, on }) {
  const [throwState, setThrowState] = useState({
    tomato: { remaining: 0, count: 0 },
    popcorn: { remaining: 0, count: 0 },
  });

  const handleThrow = useCallback(
    (item) => {
      if (throwState[item].count >= 3) return;
      onThrow(item);
    },
    [onThrow, throwState]
  );

  useEffect(() => {
    if (!on) return;
    const unsubAck = on('throw:ack', (data) => {
      setThrowState({
        tomato: { remaining: data.tomato.remaining, count: data.tomato.count },
        popcorn: { remaining: data.popcorn.remaining, count: data.popcorn.count },
      });
    });
    const unsubCooldown = on('throw:cooldown', (data) => {
      setThrowState(prev => ({
        ...prev,
        [data.item]: { remaining: data.remainingMs, count: 3 },
      }));
    });
    return () => {
      unsubAck?.();
      unsubCooldown?.();
    };
  }, [on]);

  useEffect(() => {
    const interval = setInterval(() => {
      setThrowState(prev => ({
        tomato: {
          remaining: Math.max(0, prev.tomato.remaining - 1000),
          count: prev.tomato.remaining <= 1000 ? 0 : prev.tomato.count,
        },
        popcorn: {
          remaining: Math.max(0, prev.popcorn.remaining - 1000),
          count: prev.popcorn.remaining <= 1000 ? 0 : prev.popcorn.count,
        },
      }));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const renderDots = (item, emoji) => {
    const count = throwState[item].count;
    const dots = [];
    for (let i = 0; i < 3; i++) {
      dots.push(
        <span key={i} className={i < 3 - count ? 'dot available' : 'dot used'}>
          {i < 3 - count ? emoji : '⚪'}
        </span>
      );
    }
    return dots;
  };

  const isCoolingDown = (item) => throwState[item].count >= 3;

  return (
    <div className="throw-controls">
      <div className="throw-group">
        <div className="throw-dots">{renderDots('tomato', '🍅')}</div>
        <button
          className={`throw-btn tomato ${isCoolingDown('tomato') ? 'cooldown' : ''}`}
          onClick={() => handleThrow('tomato')}
          disabled={isCoolingDown('tomato')}
          title="Throw a tomato!"
        >
          🍅 Tomato
        </button>
        {isCoolingDown('tomato') && (
          <span className="cooldown-timer">{Math.ceil(throwState.tomato.remaining / 1000)}s</span>
        )}
      </div>
      <div className="throw-group">
        <div className="throw-dots">{renderDots('popcorn', '🍿')}</div>
        <button
          className={`throw-btn popcorn ${isCoolingDown('popcorn') ? 'cooldown' : ''}`}
          onClick={() => handleThrow('popcorn')}
          disabled={isCoolingDown('popcorn')}
          title="Throw some popcorn!"
        >
          🍿 Popcorn
        </button>
        {isCoolingDown('popcorn') && (
          <span className="cooldown-timer">{Math.ceil(throwState.popcorn.remaining / 1000)}s</span>
        )}
      </div>
    </div>
  );
}
