'use client';

import { useCallback, useEffect, useState } from 'react';

/* ============================================================
   EDITIONS — "tuning the dial" changes the colour of the issue.
   Day/Night = light/dark edition.

   Each edition maps to the existing `data-mood` system so the
   shared AnalyserNode palette (read from --mood-accent* CSS vars
   in the canvas visualizers) stays consistent. We also expose
   the raw hex pair the broadcast canvases consume directly.
   ============================================================ */
export interface Edition {
  id: string;
  accent: string;
  accent2: string;
  /** which legacy mood profile to mirror for the global moodchange bridge */
  mood: 'focus' | 'relax' | 'sleep';
}

export const EDITIONS: Edition[] = [
  { id: 'sunset', accent: '#E8430F', accent2: '#F4B41A', mood: 'relax' },
  { id: 'rain', accent: '#2B5BD7', accent2: '#56B6C2', mood: 'focus' },
  { id: 'forest', accent: '#2F8A4E', accent2: '#B7C24A', mood: 'relax' },
  { id: 'dusk', accent: '#C0497E', accent2: '#7A5BD0', mood: 'sleep' },
];

export function editionById(id: string | null | undefined): Edition {
  return EDITIONS.find((e) => e.id === id) || EDITIONS[0];
}

const EDITION_KEY = 'lofiever:edition';
const NIGHT_KEY = 'lofiever:night';

const hexToRgbTriplet = (hex: string): string => {
  const c = hex.replace('#', '').trim();
  if (c.length !== 6) return '232 67 15';
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  return `${r} ${g} ${b}`;
};

/**
 * Hook owning the edition (colour) + day/night state for the broadcast UI.
 * Persists both, and bridges to the global mood system + canvas palette vars
 * so the shared AnalyserNode visualizers pick up the edition colours.
 */
export function useEdition() {
  const [edition, setEditionState] = useState<Edition>(EDITIONS[0]);
  const [night, setNightState] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  // hydrate from storage
  useEffect(() => {
    try {
      const savedEd = localStorage.getItem(EDITION_KEY);
      const savedNight = localStorage.getItem(NIGHT_KEY);
      if (savedEd) setEditionState(editionById(savedEd));
      if (savedNight != null) setNightState(savedNight === 'true');
    } catch {
      /* ignore */
    }
    setHydrated(true);
  }, []);

  // apply edition → CSS vars + bridge to legacy mood system
  useEffect(() => {
    const root = document.documentElement;
    // canvas palette consumed by RisoCover (via props) + legacy visualizers
    root.style.setProperty('--mood-accent', edition.accent);
    root.style.setProperty('--mood-accent-2', edition.accent2);
    root.style.setProperty('--mood-accent-rgb', hexToRgbTriplet(edition.accent));
    root.style.setProperty('--mood-accent-2-rgb', hexToRgbTriplet(edition.accent2));
    root.dataset.mood = edition.mood;
    window.dispatchEvent(new CustomEvent('moodchange', { detail: { mood: edition.mood } }));
  }, [edition]);

  const setEdition = useCallback((next: Edition) => {
    setEditionState(next);
    try {
      localStorage.setItem(EDITION_KEY, next.id);
    } catch {
      /* ignore */
    }
  }, []);

  const setNight = useCallback((next: boolean) => {
    setNightState(next);
    try {
      localStorage.setItem(NIGHT_KEY, String(next));
    } catch {
      /* ignore */
    }
  }, []);

  const toggleNight = useCallback(() => setNight(!night), [night, setNight]);

  return { edition, setEdition, night, setNight, toggleNight, hydrated };
}
