'use client';

import { useEffect, useMemo, useState } from 'react';
import { useLocale } from 'next-intl';

type Mood = 'focus' | 'relax' | 'sleep';

const DEFAULT_MOOD: Mood = 'relax';

export default function MoodToggle() {
  const locale = useLocale();
  const labels = useMemo(
    () => ({
      focus: locale === 'en' ? 'Focus' : 'Foco',
      relax: locale === 'en' ? 'Relax' : 'Relax',
      sleep: locale === 'en' ? 'Sleep' : 'Sono',
    }),
    [locale],
  );

  const [mood, setMood] = useState<Mood>(DEFAULT_MOOD);

  useEffect(() => {
    const saved = (typeof window !== 'undefined' && localStorage.getItem('mood')) as Mood | null;
    const initial = saved || DEFAULT_MOOD;
    setMood(initial);
    document.documentElement.dataset.mood = initial;
  }, []);

  const applyMood = (nextMood: Mood) => {
    setMood(nextMood);
    document.documentElement.dataset.mood = nextMood;
    localStorage.setItem('mood', nextMood);
    window.dispatchEvent(new CustomEvent('moodchange', { detail: { mood: nextMood } }));
  };

  return (
    <div className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-1.5 py-1 text-[11px] text-white/70 backdrop-blur-sm shadow-inner">
      {(['focus', 'relax', 'sleep'] as Mood[]).map((item) => (
        <button
          key={item}
          type="button"
          onClick={() => applyMood(item)}
          className={`px-2.5 py-1 rounded-full transition-all ${
            mood === item
              ? 'bg-white/15 text-white shadow-[0_6px_16px_rgba(0,0,0,0.35)]'
              : 'text-white/60 hover:text-white hover:bg-white/10'
          }`}
          aria-label={labels[item]}
        >
          {labels[item]}
        </button>
      ))}
    </div>
  );
}
