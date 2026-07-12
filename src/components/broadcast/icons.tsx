'use client';

import type { SVGProps } from 'react';

/* ============================================================
   ICONS — thin printed glyphs for the Daily Broadcast zine
   ============================================================ */
type IconProps = SVGProps<SVGSVGElement>;

export const Ic = {
  play: (p: IconProps) => (
    <svg viewBox="0 0 24 24" fill="currentColor" {...p}>
      <path d="M7 4.5v15l13-7.5z" />
    </svg>
  ),
  pause: (p: IconProps) => (
    <svg viewBox="0 0 24 24" fill="currentColor" {...p}>
      <rect x="6" y="4.5" width="4.2" height="15" />
      <rect x="13.8" y="4.5" width="4.2" height="15" />
    </svg>
  ),
  sun: (p: IconProps) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" {...p}>
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M19.1 4.9l-1.8 1.8M6.7 17.3l-1.8 1.8" />
    </svg>
  ),
  moon: (p: IconProps) => (
    <svg viewBox="0 0 24 24" fill="currentColor" {...p}>
      <path d="M21 12.8A9 9 0 1111.2 3a7 7 0 109.8 9.8z" />
    </svg>
  ),
  dial: (p: IconProps) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 12l4-4" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
    </svg>
  ),
  zen: (p: IconProps) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" {...p}>
      <path d="M4 9V5a1 1 0 011-1h4M15 4h4a1 1 0 011 1v4M20 15v4a1 1 0 01-1 1h-4M9 20H5a1 1 0 01-1-1v-4" />
    </svg>
  ),
  left: (p: IconProps) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" {...p}>
      <path d="M15 6l-6 6 6 6" />
    </svg>
  ),
  right: (p: IconProps) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" {...p}>
      <path d="M9 6l6 6-6 6" />
    </svg>
  ),
  close: (p: IconProps) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" {...p}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  ),
} as const;

/**
 * Lofine mascot — a little cassette with a face (single-ink brand glyph).
 * Lofine is the AI DJ host of the station.
 */
export function LofineMark({ size = 26, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg
      className="lofine-mark"
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      stroke={color}
      strokeWidth="2"
      aria-hidden="true"
    >
      <rect x="3" y="7" width="26" height="18" rx="2.5" />
      <circle cx="11" cy="16" r="3" />
      <circle cx="21" cy="16" r="3" />
      <path d="M9 23h14" strokeLinecap="round" />
      <path d="M11.5 11.5q.8-1.4 2-1.4M18.5 11.5q.8-1.4 2-1.4" strokeLinecap="round" />
    </svg>
  );
}
