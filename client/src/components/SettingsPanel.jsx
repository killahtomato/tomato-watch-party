import { useState, useEffect } from 'react';
import { THEMES, ACCENTS, getTheme, getAccent, setTheme, setAccent } from '../utils/theme.js';

export default function SettingsPanel({ open, onClose }) {
  const [theme, setActiveTheme] = useState(getTheme());
  const [accent, setActiveAccent] = useState(getAccent());

  useEffect(() => {
    if (open) {
      setActiveTheme(getTheme());
      setActiveAccent(getAccent());
    }
  }, [open]);

  if (!open) return null;

  const handleTheme = (id) => {
    setTheme(id);
    setActiveTheme(id);
  };

  const handleAccent = (id) => {
    setAccent(id);
    setActiveAccent(id);
  };

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <h3>Settings</h3>
          <button className="settings-close" onClick={onClose}>✕</button>
        </div>

        <div className="settings-section">
          <h4>Theme</h4>
          <div className="theme-grid">
            {THEMES.map((item) => (
              <button
                key={item.id}
                className={`theme-swatch ${theme === item.id ? 'active' : ''}`}
                onClick={() => handleTheme(item.id)}
                title={item.name}
              >
                <span
                  className="theme-swatch-colors"
                  style={{ background: `linear-gradient(135deg, ${item.swatch[0]} 50%, ${item.swatch[1]} 50%)` }}
                />
                <span className="theme-swatch-name">{item.name}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="settings-section">
          <h4>Accent</h4>
          <div className="accent-row">
            {ACCENTS.map((item) => (
              <button
                key={item.id}
                className={`accent-swatch ${accent === item.id ? 'active' : ''}`}
                style={{ background: item.color }}
                onClick={() => handleAccent(item.id)}
                title={item.name}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
