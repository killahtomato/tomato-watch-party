import { useEffect, useRef } from 'react';
import { isAnbyTheme } from '../utils/anby.js';

function readAccent() {
  const value = getComputedStyle(document.documentElement).getPropertyValue('--accent');
  return value.trim() || '#e63946';
}

function hexToRgba(hex, alpha) {
  const clean = String(hex).replace('#', '');
  const full = clean.length === 3 ? clean.split('').map(c => c + c).join('') : clean;
  const num = parseInt(full, 16);
  if (!Number.isFinite(num)) return `rgba(230, 57, 70, ${alpha})`;
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export const VISUALIZER_VARIANTS = [
  ['radial', 'Radial'],
  ['bars', 'Bars'],
  ['wave', 'Wave'],
];

export default function AudioVisualizer({ audioRef, isPlaying, unlocked = true, variant = 'radial' }) {
  const canvasRef = useRef(null);
  const audioCtxRef = useRef(null);
  const analyserRef = useRef(null);
  const animRef = useRef(null);
  const variantRef = useRef(variant);
  variantRef.current = variant;
  const accentRef = useRef(readAccent());
  const themeRef = useRef(typeof document !== 'undefined' ? document.documentElement.dataset.theme : '');

  useEffect(() => {
    const update = () => {
      accentRef.current = readAccent();
      themeRef.current = document.documentElement.dataset.theme;
    };
    update();
    window.addEventListener('twp:settings', update);
    return () => window.removeEventListener('twp:settings', update);
  }, []);

  useEffect(() => {
    const audio = audioRef?.current;
    const canvas = canvasRef.current;
    if (!audio || !canvas) return;

    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.8;

    const source = audioCtx.createMediaElementSource(audio);
    source.connect(analyser);
    analyser.connect(audioCtx.destination);

    const canvasCtx = canvas.getContext('2d');

    audioCtxRef.current = audioCtx;
    analyserRef.current = analyser;

    const freqData = new Uint8Array(analyser.frequencyBinCount);
    const timeData = new Uint8Array(analyser.frequencyBinCount);

    const drawRadial = (w, h, dpr) => {
      const cx = w / 2;
      const cy = h / 2;
      const maxR = Math.min(w, h) * 0.38;
      const accent = accentRef.current;

      const numRings = 5;
      const ringCount = freqData.length;

      for (let ring = 0; ring < numRings; ring++) {
        const ringRatio = ring / numRings;
        const baseRadius = maxR * (0.25 + ringRatio * 0.7);
        const barCount = Math.floor(ringCount * (0.4 + ringRatio * 0.6));

        for (let i = 0; i < barCount; i++) {
          const idx = Math.floor((i / barCount) * ringCount);
          const amplitude = freqData[idx] / 255;
          const angle = (i / barCount) * Math.PI * 2 - Math.PI / 2;
          const barLength = amplitude * maxR * 0.25;

          const x1 = cx + Math.cos(angle) * baseRadius;
          const y1 = cy + Math.sin(angle) * baseRadius;
          const x2 = cx + Math.cos(angle) * (baseRadius + barLength);
          const y2 = cy + Math.sin(angle) * (baseRadius + barLength);

          canvasCtx.beginPath();
          canvasCtx.moveTo(x1, y1);
          canvasCtx.lineTo(x2, y2);
          canvasCtx.strokeStyle = hexToRgba(accent, 0.3 + amplitude * 0.7);
          canvasCtx.lineWidth = (2 + amplitude * 4) * dpr;
          canvasCtx.lineCap = 'round';
          canvasCtx.stroke();
        }
      }

      canvasCtx.save();
      canvasCtx.font = `${48 * dpr}px serif`;
      canvasCtx.textAlign = 'center';
      canvasCtx.textBaseline = 'middle';
      canvasCtx.shadowColor = hexToRgba(accent, 0.6);
      canvasCtx.shadowBlur = 20 * dpr;
      canvasCtx.fillText(isAnbyTheme(themeRef.current) ? '\u{1F354}' : '\u{1F345}', cx, cy);
      canvasCtx.restore();
    };

    const drawBars = (w, h, dpr) => {
      const barCount = 72;
      const gap = 2 * dpr;
      const barWidth = Math.max(2 * dpr, (w - gap * (barCount - 1)) / barCount);
      const totalWidth = barCount * barWidth + gap * (barCount - 1);
      const startX = (w - totalWidth) / 2;
      const step = Math.max(1, Math.floor(freqData.length / barCount));
      const accent = accentRef.current;

      const baseline = h * 0.82;
      for (let i = 0; i < barCount; i++) {
        const amplitude = freqData[i * step] / 255;
        const barHeight = Math.max(2 * dpr, amplitude * h * 0.5);
        const x = startX + i * (barWidth + gap);
        canvasCtx.fillStyle = hexToRgba(accent, 0.35 + amplitude * 0.65);
        canvasCtx.fillRect(x, baseline - barHeight, barWidth, barHeight);
      }
    };

    const drawWave = (w, h, dpr) => {
      analyser.getByteTimeDomainData(timeData);
      const accent = accentRef.current;
      const points = 120;
      const step = Math.max(1, Math.floor(timeData.length / points));

      canvasCtx.lineWidth = 2 * dpr;
      canvasCtx.strokeStyle = hexToRgba(accent, 0.9);
      canvasCtx.lineJoin = 'round';
      canvasCtx.beginPath();
      for (let i = 0; i < points; i++) {
        const value = (timeData[i * step] - 128) / 128;
        const x = (i / (points - 1)) * w;
        const y = h / 2 + value * h * 0.32;
        if (i === 0) canvasCtx.moveTo(x, y);
        else canvasCtx.lineTo(x, y);
      }
      canvasCtx.stroke();
    };

    const draw = () => {
      animRef.current = requestAnimationFrame(draw);
      analyser.getByteFrequencyData(freqData);

      const dpr = window.devicePixelRatio || 1;
      const w = canvas.width = canvas.offsetWidth * dpr;
      const h = canvas.height = canvas.offsetHeight * dpr;

      canvasCtx.clearRect(0, 0, w, h);

      if (variantRef.current === 'bars') drawBars(w, h, dpr);
      else if (variantRef.current === 'wave') drawWave(w, h, dpr);
      else drawRadial(w, h, dpr);
    };

    draw();

    return () => {
      cancelAnimationFrame(animRef.current);
      audioCtx.close().catch(() => {});
    };
  }, [audioRef]);

  useEffect(() => {
    const audioCtx = audioCtxRef.current;
    if (!audioCtx) return;
    if (unlocked) audioCtx.resume().catch(() => {});
  }, [unlocked]);

  useEffect(() => {
    const audioCtx = audioCtxRef.current;
    if (!audioCtx) return;
    if (isPlaying) {
      audioCtx.resume().catch(() => {});
    } else {
      audioCtx.suspend().catch(() => {});
    }
  }, [isPlaying]);

  return (
    <div className="audio-visualizer">
      <canvas ref={canvasRef} />
    </div>
  );
}
