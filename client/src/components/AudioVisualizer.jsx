import { useEffect, useRef } from 'react';

export default function AudioVisualizer({ audioRef, isPlaying }) {
  const canvasRef = useRef(null);
  const audioCtxRef = useRef(null);
  const analyserRef = useRef(null);
  const animRef = useRef(null);

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

    const dataArray = new Uint8Array(analyser.frequencyBinCount);

    const draw = () => {
      animRef.current = requestAnimationFrame(draw);
      analyser.getByteFrequencyData(dataArray);

      const dpr = window.devicePixelRatio || 1;
      const w = canvas.width = canvas.offsetWidth * dpr;
      const h = canvas.height = canvas.offsetHeight * dpr;
      const cx = w / 2;
      const cy = h / 2;
      const maxR = Math.min(w, h) * 0.38;

      canvasCtx.clearRect(0, 0, w, h);

      const numRings = 5;
      const ringCount = dataArray.length;

      for (let ring = 0; ring < numRings; ring++) {
        const ringRatio = ring / numRings;
        const baseRadius = maxR * (0.25 + ringRatio * 0.7);
        const barCount = Math.floor(ringCount * (0.4 + ringRatio * 0.6));

        for (let i = 0; i < barCount; i++) {
          const idx = Math.floor((i / barCount) * ringCount);
          const amplitude = dataArray[idx] / 255;
          const angle = (i / barCount) * Math.PI * 2 - Math.PI / 2;
          const barLength = amplitude * maxR * 0.25;

          const innerR = baseRadius;
          const outerR = baseRadius + barLength;

          const x1 = cx + Math.cos(angle) * innerR;
          const y1 = cy + Math.sin(angle) * innerR;
          const x2 = cx + Math.cos(angle) * outerR;
          const y2 = cy + Math.sin(angle) * outerR;

          const alpha = 0.3 + amplitude * 0.7;
          const lineWidth = (2 + amplitude * 4) * dpr;

          canvasCtx.beginPath();
          canvasCtx.moveTo(x1, y1);
          canvasCtx.lineTo(x2, y2);
          canvasCtx.strokeStyle = `rgba(230, 57, 70, ${alpha})`;
          canvasCtx.lineWidth = lineWidth;
          canvasCtx.lineCap = 'round';
          canvasCtx.stroke();
        }
      }

      canvasCtx.save();
      canvasCtx.font = `${48 * dpr}px serif`;
      canvasCtx.textAlign = 'center';
      canvasCtx.textBaseline = 'middle';
      canvasCtx.shadowColor = 'rgba(230, 57, 70, 0.6)';
      canvasCtx.shadowBlur = 20 * dpr;
      canvasCtx.fillText('\u{1F345}', cx, cy);
      canvasCtx.restore();
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
