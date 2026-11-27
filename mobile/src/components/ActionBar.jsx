import { useEffect, useState, useCallback } from 'react';
import { useSettings } from '@client/hooks/useSettings.js';
import { reactionsFor } from '@client/utils/anby.js';

const MOVIE_REACTIONS = ['👏', '😂', '😱', '❤️'];
const DJ_REACTIONS = ['🍾', '💸', '❄️', '🤘'];

export default function ActionBar({ room, on, emit }) {
  const settings = useSettings();
  const [throwState, setThrowState] = useState({
    tomato: { count: 0, resetAt: 0 },
    popcorn: { count: 0, resetAt: 0 },
  });
  const [reactionsEnabled, setReactionsEnabled] = useState(true);

  useEffect(() => {
    const unsubAck = on('throw:ack', (data) => {
      setThrowState({
        tomato: { count: data.tomato.count, resetAt: Date.now() + data.tomato.remaining },
        popcorn: { count: data.popcorn.count, resetAt: Date.now() + data.popcorn.remaining },
      });
    });
    const unsubCooldown = on('throw:cooldown', (data) => {
      setThrowState(prev => ({
        ...prev,
        [data.item]: { count: 3, resetAt: Date.now() + data.remaining },
      }));
    });
    const unsubReactions = on('reactions:enabled', setReactionsEnabled);
    return () => {
      unsubAck?.();
      unsubCooldown?.();
      unsubReactions?.();
    };
  }, [on]);

  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      setThrowState(prev => {
        let changed = false;
        const next = { ...prev };
        for (const item of ['tomato', 'popcorn']) {
          if (next[item].count >= 3 && next[item].resetAt && now >= next[item].resetAt) {
            next[item] = { count: 0, resetAt: 0 };
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const handleThrow = useCallback((item) => {
    if (throwState[item].count >= 3) return;
    emit('throw', { item });
  }, [emit, throwState]);

  const handleReaction = useCallback((emoji) => {
    if (room === 'movie') emit('reaction', { emoji });
    else emit('dj:reaction', { emoji });
  }, [emit, room]);

  const reactionEmojis = reactionsFor(settings.theme, room === 'movie' ? MOVIE_REACTIONS : DJ_REACTIONS);

  if (settings.reduceMotion) return null;

  return (
    <div className="mobile-action-bar">
      {room === 'movie' && (
        <div className="mobile-action-group">
          <button
            className={`mobile-action-btn ${throwState.tomato.count >= 3 ? 'cooldown' : ''}`}
            onClick={() => handleThrow('tomato')}
            disabled={throwState.tomato.count >= 3}
            title="Throw a tomato"
          >
            🍅
          </button>
          <button
            className={`mobile-action-btn ${throwState.popcorn.count >= 3 ? 'cooldown' : ''}`}
            onClick={() => handleThrow('popcorn')}
            disabled={throwState.popcorn.count >= 3}
            title="Throw some popcorn"
          >
            🍿
          </button>
        </div>
      )}
      <div className="mobile-action-group">
        {reactionEmojis.map(emoji => (
          <button
            key={emoji}
            className="mobile-action-btn"
            onClick={() => handleReaction(emoji)}
            disabled={!reactionsEnabled}
            title={`React with ${emoji}`}
          >
            {emoji}
          </button>
        ))}
      </div>
    </div>
  );
}
