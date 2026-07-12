'use client';

import { useRef, useEffect, useState } from 'react';

/* ============================================================
   RISO COVER — deterministic generated print per track.

   Real risograph technique: graded halftone sky, a disc with
   colour misregistration (the "third tone"), a sweeping ink
   horizon, a ghost serial number, and paper grain.

   When a real `artworkUrl` exists we render the photo and lay
   a halftone + grain treatment over it so it still reads as a
   printed edition. Otherwise we generate the cover from a seed.
   ============================================================ */

function mulberry32(a: number) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable seed from a track id (so generated art is deterministic per track). */
export function seedFromId(id: string | undefined | null): number {
  if (!id) return 7;
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 1000;
}

export interface RisoCoverProps {
  seed: number;
  accent: string;
  accent2: string;
  paper: string;
  ink: string;
  night: boolean;
  /** ghost serial number drawn in the corner */
  num?: number | null;
  /** SIDE A label */
  label?: string | null;
  /** real artwork; when present it is rendered with a print treatment */
  artworkUrl?: string | null;
  alt?: string;
}

export function RisoCover({
  seed,
  accent,
  accent2,
  paper,
  ink,
  night,
  num = null,
  label = null,
  artworkUrl = null,
  alt = '',
}: RisoCoverProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [photoFailed, setPhotoFailed] = useState(false);
  const usePhoto = !!artworkUrl && !photoFailed;

  useEffect(() => {
    // When a real photo is shown we only draw the texture overlay; the
    // generated composition is skipped (the photo IS the art).
    const cv = ref.current;
    if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    const W = cv.clientWidth;
    const H = cv.clientHeight;
    if (W === 0 || H === 0) return;
    cv.width = W * dpr;
    cv.height = H * dpr;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    const rnd = mulberry32((seed + 1) * 2654435761);
    const blend: GlobalCompositeOperation = night ? 'screen' : 'multiply';

    if (usePhoto) {
      // Photo treatment: halftone dots + grain over the (separately rendered) <img>.
      const step = Math.max(4.6, W / 56);
      const maxR = step * 0.66;
      ctx.globalCompositeOperation = blend;
      for (let y = 0; y < H + step; y += step) {
        for (let x = 0; x < W + step; x += step) {
          const v = 0.25 + rnd() * 0.2;
          const r = v * maxR;
          if (r < 0.4) continue;
          ctx.globalAlpha = night ? 0.16 : 0.14;
          ctx.fillStyle = night ? '#fff' : '#000';
          ctx.beginPath();
          ctx.arc(x, y, Math.min(r, step * 0.72), 0, 6.283);
          ctx.fill();
        }
      }
      // grain
      ctx.globalCompositeOperation = 'source-over';
      const grainCol = night ? 'rgba(242,231,206,' : 'rgba(28,24,19,';
      const grainCount = Math.min(40000, W * H * 0.01);
      for (let i = 0; i < grainCount; i++) {
        const a = rnd() * (night ? 0.1 : 0.08);
        ctx.fillStyle = grainCol + a + ')';
        ctx.fillRect(rnd() * W, rnd() * H, 1, 1);
      }
      ctx.globalAlpha = 1;
      return;
    }

    // ---- generated riso composition ----
    ctx.fillStyle = paper;
    ctx.fillRect(0, 0, W, H);

    const step = Math.max(4.6, W / 56); // halftone grid pitch
    const maxR = step * 0.66;

    const comp = Math.floor(rnd() * 3); // 0 sun-low · 1 moon-high · 2 eclipse
    const cx = (0.34 + rnd() * 0.4) * W;
    const cy = comp === 1 ? (0.16 + rnd() * 0.16) * H : (0.4 + rnd() * 0.26) * H;
    const discR = (0.3 + rnd() * 0.14) * W;
    const horizon = (0.6 + rnd() * 0.22) * H;
    const bandAngle = (-0.5 + rnd()) * 0.5;
    const lx = rnd() < 0.5 ? -0.2 * W : 1.2 * W; // light source corner
    const ly = -0.2 * H;
    const maxLight = Math.hypot(W * 1.4, H * 1.4);

    const dot = (x: number, y: number, r: number, col: string, a: number) => {
      if (r < 0.32) return;
      ctx.globalAlpha = a;
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(x, y, Math.min(r, step * 0.72), 0, 6.283);
      ctx.fill();
    };

    ctx.globalCompositeOperation = blend;

    // LAYER 1 — graded sky (accent-2), misregistered +offset
    for (let y = 0; y < H + step; y += step) {
      for (let x = 0; x < W + step; x += step) {
        let v = (y / H) * 0.72 + (Math.hypot(x - lx, y - ly) / maxLight) * 0.5;
        const dd = Math.hypot(x - cx, y - cy);
        if (dd < discR * 1.04) v *= 0.18; // keep disc area clean
        dot(x + 1.6, y + 1.1, v * maxR, accent2, 0.82);
      }
    }

    // LAYER 2 — the disc (accent), solid core → halftone rim, misregistered −offset
    const r0 = discR;
    for (let y = cy - r0 - step; y < cy + r0 + step; y += step) {
      for (let x = cx - r0 - step; x < cx + r0 + step; x += step) {
        const d = Math.hypot(x - cx, y - cy);
        if (d > r0) continue;
        const v = Math.min(1, (r0 - d) / (r0 * 0.42)); // solid centre, soft edge
        dot(x - 1.6, y - 0.9, v * maxR, accent, 0.9);
      }
    }

    // LAYER 3 — a sweeping ink band / horizon (texture + tension)
    ctx.save();
    ctx.globalAlpha = night ? 0.5 : 0.62;
    ctx.fillStyle = ink;
    ctx.translate(0, horizon);
    ctx.rotate(bandAngle);
    if (comp === 2) {
      // eclipse: thin ink ring around disc
      ctx.translate(0, -horizon);
      ctx.globalAlpha = 0.7;
      ctx.lineWidth = Math.max(2, W * 0.012);
      ctx.strokeStyle = ink;
      ctx.beginPath();
      ctx.arc(cx, cy, discR * 1.14, 0, 6.283);
      ctx.stroke();
    } else {
      ctx.fillRect(-W, 0, W * 3, H); // ground below horizon
    }
    ctx.restore();

    // ghost serial number, hand-set in the corner
    if (num != null) {
      ctx.globalCompositeOperation = blend;
      ctx.globalAlpha = night ? 0.22 : 0.16;
      ctx.fillStyle = accent;
      ctx.font = `900 ${Math.round(W * 0.5)}px Archivo, sans-serif`;
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(String(num).padStart(2, '0'), W * 0.04, H * 0.98);
    }

    // paper grain
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    const grainCol = night ? 'rgba(242,231,206,' : 'rgba(28,24,19,';
    const grainCount = Math.min(60000, W * H * 0.012);
    for (let i = 0; i < grainCount; i++) {
      const a = rnd() * (night ? 0.1 : 0.08);
      ctx.fillStyle = grainCol + a + ')';
      ctx.fillRect(rnd() * W, rnd() * H, 1, 1);
    }
  }, [seed, accent, accent2, paper, ink, night, num, usePhoto]);

  return (
    <>
      {usePhoto && artworkUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          className="art-photo"
          src={artworkUrl}
          alt={alt}
          onError={() => setPhotoFailed(true)}
        />
      )}
      <canvas ref={ref} className="art-canvas" aria-hidden="true" />
      {label && (
        <div className="art-label mono">
          <span>SIDE A</span>
          <span>{label}</span>
        </div>
      )}
    </>
  );
}
