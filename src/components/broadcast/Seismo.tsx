'use client';

import { useRef, useEffect } from 'react';

/* ============================================================
   SEISMOGRAPH — the printed audio visualizer.

   Draws mirrored ink bars from a centre rule. When a real
   AnalyserNode is connected and audio is playing it reacts to
   the live frequency data; otherwise it falls back to the
   procedural waveform from the original prototype so it always
   looks alive.
   ============================================================ */
interface SeismoProps {
  playing: boolean;
  accent: string;
  ink: string;
  bars?: number;
  analyser?: AnalyserNode | null;
}

export function Seismo({ playing, accent, ink, bars = 56, analyser = null }: SeismoProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const raf = useRef(0);
  const data = useRef<number[]>(new Array(bars).fill(0.04));
  const playRef = useRef(playing);
  const accentRef = useRef(accent);
  const inkRef = useRef(ink);
  const analyserRef = useRef<AnalyserNode | null>(analyser);

  useEffect(() => {
    playRef.current = playing;
  }, [playing]);
  useEffect(() => {
    accentRef.current = accent;
    inkRef.current = ink;
  }, [accent, ink]);
  useEffect(() => {
    analyserRef.current = analyser;
  }, [analyser]);

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    let t = 0;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      cv.width = cv.clientWidth * dpr;
      cv.height = cv.clientHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(cv);

    const freq = new Uint8Array(1024);

    const draw = () => {
      raf.current = requestAnimationFrame(draw);
      t += 0.05;
      const W = cv.clientWidth;
      const H = cv.clientHeight;
      const mid = H / 2;
      ctx.clearRect(0, 0, W, H);

      // centre rule
      ctx.strokeStyle = inkRef.current;
      ctx.globalAlpha = 0.18;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, mid);
      ctx.lineTo(W, mid);
      ctx.stroke();
      ctx.globalAlpha = 1;

      const an = analyserRef.current;
      let live: Uint8Array | null = null;
      if (an && playRef.current) {
        an.getByteFrequencyData(freq);
        live = freq;
      }

      const gap = 3;
      const bw = (W - (bars - 1) * gap) / bars;
      for (let i = 0; i < bars; i++) {
        let target: number;
        if (live) {
          // map bar i to a frequency bin (skip the very top of the spectrum)
          const idx = Math.floor((i / bars) * (an!.frequencyBinCount * 0.7));
          target = live[idx] / 255;
        } else if (playRef.current) {
          const env = Math.sin((i / bars) * Math.PI); // louder in middle
          target =
            (0.18 +
              Math.abs(Math.sin(t * 1.7 + i * 0.5)) * 0.7 +
              Math.abs(Math.sin(t * 3.1 + i)) * 0.3) *
            env;
        } else {
          target = 0.04 + Math.abs(Math.sin(t * 0.6 + i * 0.4)) * 0.05;
        }
        data.current[i] += (target - data.current[i]) * 0.25;
        const h = Math.max(2, data.current[i] * (H * 0.92));
        const x = i * (bw + gap);
        ctx.fillStyle = data.current[i] > 0.55 ? accentRef.current : inkRef.current;
        ctx.fillRect(x, mid - h / 2, bw, h / 2);
        ctx.globalAlpha = 0.45;
        ctx.fillRect(x, mid, bw, h / 2);
        ctx.globalAlpha = 1;
      }
    };
    draw();

    return () => {
      cancelAnimationFrame(raf.current);
      ro.disconnect();
    };
  }, [bars]);

  return <canvas ref={ref} />;
}
