import { useState, useEffect } from 'react';
import { THEMES, ACCENTS } from '../utils/theme.js';
import { getSettings, updateSettings, setTheme, setAccent } from '../utils/settings.js';

const QUALITIES = ['1080p', '720p', '480p'];
const SOURCES = [
  ['all', 'All sources'],
  ['aniwatch', 'aniwatch'],
  ['gogoanime', 'gogoanime'],
  ['9anime', '9anime'],
  ['hianime', 'hianime'],
  ['animegg', 'animegg'],
  ['bilibili', 'bilibili'],
  ['youtube', 'youtube'],
  ['nyaa', 'nyaa'],
  ['tpb', 'tpb'],
];
const MODES = [['sub', 'Sub'], ['dub', 'Dub']];

function Toggle({ label, checked, onChange, setting }) {
  return (
    <button
      type="button"
      className={`setting-toggle ${checked ? 'on' : ''}`}
      data-setting={setting}
      aria-pressed={checked}
      onClick={() => onChange(!checked)}
    >
      <span className="setting-toggle-label">{label}</span>
      <span className="toggle-track"><span className="toggle-thumb" /></span>
    </button>
  );
}

export default function SettingsPanel({ open, onClose }) {
  const [settings, setSettings] = useState(getSettings());

  useEffect(() => {
    if (open) setSettings(getSettings());
  }, [open]);

  if (!open) return null;

  const patch = (values) => setSettings(updateSettings(values));
  const handleTheme = (id) => {
    setTheme(id);
    setSettings(getSettings());
  };
  const handleAccent = (id) => {
    setAccent(id);
    setSettings(getSettings());
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
                className={`theme-swatch ${settings.theme === item.id ? 'active' : ''}`}
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
          <Toggle
            setting="followSystem"
            label="Follow system theme"
            checked={settings.followSystem}
            onChange={(value) => patch({ followSystem: value })}
          />
          <Toggle
            setting="reduceMotion"
            label="Reduce motion"
            checked={settings.reduceMotion}
            onChange={(value) => patch({ reduceMotion: value })}
          />
        </div>

        <div className="settings-section">
          <h4>Accent</h4>
          <div className="accent-row">
            {ACCENTS.map((item) => (
              <button
                key={item.id}
                className={`accent-swatch ${settings.accent === item.id ? 'active' : ''}`}
                style={{ background: item.color }}
                onClick={() => handleAccent(item.id)}
                title={item.name}
              />
            ))}
          </div>
        </div>

        <div className="settings-section">
          <h4>Playback</h4>
          <label className="setting-field">
            <span>Default quality</span>
            <select
              value={settings.defaultQuality}
              onChange={(e) => patch({ defaultQuality: e.target.value })}
            >
              {QUALITIES.map((q) => <option key={q} value={q}>{q}</option>)}
            </select>
          </label>
          <Toggle
            setting="autoplayNext"
            label="Auto-play next"
            checked={settings.autoplayNext}
            onChange={(value) => patch({ autoplayNext: value })}
          />
          <label className="setting-field">
            <span>Volume</span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={settings.volume}
              onChange={(e) => patch({ volume: parseFloat(e.target.value) })}
            />
          </label>
        </div>

        <div className="settings-section">
          <h4>Web</h4>
          <label className="setting-field">
            <span>Preferred source</span>
            <select
              value={settings.webSource}
              onChange={(e) => patch({ webSource: e.target.value })}
            >
              {SOURCES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <div className="setting-field">
            <span>Default audio</span>
            <div className="segmented">
              {MODES.map(([value, label]) => (
                <button
                  key={value}
                  className={settings.webMode === value ? 'active' : ''}
                  onClick={() => patch({ webMode: value })}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="settings-section">
          <h4>Viewers</h4>
          <Toggle
            setting="showHealth"
            label="Show health and ping"
            checked={settings.showHealth}
            onChange={(value) => patch({ showHealth: value })}
          />
        </div>
      </div>
    </div>
  );
}
