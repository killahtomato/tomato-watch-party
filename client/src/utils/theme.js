export const THEMES = [
  { id: 'dark', name: 'Tomato Dark', swatch: ['#0d0d0f', '#ff4444'] },
  { id: 'light', name: 'Light', swatch: ['#f4f4f7', '#ff4444'] },
  { id: 'amoled', name: 'AMOLED', swatch: ['#000000', '#ff4444'] },
  { id: 'midnight', name: 'Midnight', swatch: ['#0a0f1e', '#4488ff'] },
  { id: 'forest', name: 'Forest', swatch: ['#0c1410', '#44cc88'] },
  { id: 'ocean', name: 'Ocean', swatch: ['#081418', '#44cccc'] },
  { id: 'sunset', name: 'Sunset', swatch: ['#160d0c', '#ff8844'] },
  { id: 'sakura', name: 'Sakura', swatch: ['#170d12', '#ff66aa'] },
  { id: 'grape', name: 'Grape', swatch: ['#120d1c', '#aa66ff'] },
  { id: 'amber', name: 'Amber', swatch: ['#17110a', '#ffaa33'] },
  { id: 'espresso', name: 'Espresso', swatch: ['#140f0c', '#b09888'] },
  { id: 'mono', name: 'Mono', swatch: ['#101010', '#909090'] },
  { id: 'cyberpunk', name: 'Cyberpunk', swatch: ['#0d0a14', '#ff66aa'] },
];

export const ACCENTS = [
  { id: 'red', name: 'Red', color: '#ff4444' },
  { id: 'orange', name: 'Orange', color: '#ff8844' },
  { id: 'amber', name: 'Amber', color: '#ffaa33' },
  { id: 'green', name: 'Green', color: '#44cc88' },
  { id: 'teal', name: 'Teal', color: '#44cccc' },
  { id: 'blue', name: 'Blue', color: '#4488ff' },
  { id: 'purple', name: 'Purple', color: '#aa66ff' },
  { id: 'pink', name: 'Pink', color: '#ff66aa' },
];

export {
  getSettings,
  updateSettings,
  applySettings,
  initSettings,
  getTheme,
  getAccent,
  setTheme,
  setAccent,
} from './settings.js';
