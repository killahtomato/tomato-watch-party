import { useState, useEffect } from 'react';
import { getSettings } from '../utils/settings.js';

export function useSettings() {
  const [settings, setSettings] = useState(getSettings());

  useEffect(() => {
    const handler = (event) => setSettings(event.detail);
    window.addEventListener('twp:settings', handler);
    return () => window.removeEventListener('twp:settings', handler);
  }, []);

  return settings;
}
