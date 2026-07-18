'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { usePathname, useRouter } from '@/i18n/routing';
import { Ic } from './icons';
import type { Edition } from './editions';
import { EDITIONS } from './editions';

interface MastheadProps {
  playing: boolean;
  edition: Edition;
  onEdition: (e: Edition) => void;
  night: boolean;
  onToggleNight: () => void;
  onZen: () => void;
  dateStr: string;
}

/* ============================================================
   MASTHEAD — newspaper nameplate + dateline + controls
   ============================================================ */
export function Masthead({
  playing,
  edition,
  onEdition,
  night,
  onToggleNight,
  onZen,
  dateStr,
}: MastheadProps) {
  const t = useTranslations('player');
  const tCommon = useTranslations('common');
  const tBroadcast = useTranslations('broadcast');
  const locale = useLocale();
  const [dialOpen, setDialOpen] = useState(false);
  const isEnglish = locale === 'en';

  return (
    <header className="masthead">
      <div className="masthead-top">
        <div className="nameplate">
          <h1 className="wordmark">
            Lofieve<span className="dot-r">r</span>
          </h1>
          <p className="tagline">{tCommon('appTagline')}</p>
        </div>
        <div className="masthead-controls">
          <div className="pop-wrap">
            <button
              className="chip icon-only"
              aria-label={tBroadcast('palette.aria')}
              aria-expanded={dialOpen}
              onClick={() => setDialOpen((o) => !o)}
            >
              <Ic.dial />
            </button>
            {dialOpen && (
              <Dial
                current={edition}
                title={tBroadcast('palette.label')}
                labelFor={(id) => tBroadcast(`palette.options.${id}`)}
                onPick={(e) => {
                  onEdition(e);
                  setDialOpen(false);
                }}
                onClose={() => setDialOpen(false)}
              />
            )}
          </div>
          <button
            className="chip icon-only"
            aria-label={
              night
                ? isEnglish
                  ? 'Use light edition'
                  : 'Usar edição clara'
                : isEnglish
                  ? 'Use night edition'
                  : 'Usar edição noturna'
            }
            onClick={onToggleNight}
          >
            {night ? <Ic.sun /> : <Ic.moon />}
          </button>
          <button className="chip" onClick={onZen}>
            <Ic.zen /> {t('zenMode.activate')}
          </button>
          <LanguageChip />
        </div>
      </div>
      <div className="dateline">
        <span className="dl-item strong">
          <span className={`dl-blip ${playing ? 'live' : ''}`} />
          {playing ? t('live') : t('paused')}
        </span>
        <span className="dl-item">{tBroadcast('status.stream')}</span>
        <span className="dl-item">{tBroadcast('status.instrumental')}</span>
        <span className="dl-item">{tBroadcast('status.catalog')}</span>
        <span className="dl-item strong wide">{tBroadcast('status.shared')}</span>
        <span className="dl-item">{dateStr}</span>
      </div>
    </header>
  );
}

/** Edition-styled language toggle (chip), so it matches the printed UI. */
function LanguageChip() {
  const tLang = useTranslations('language');
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();
  const other = locale === 'pt' ? 'en' : 'pt';

  return (
    <button
      className="chip"
      disabled={isPending}
      aria-label={tLang('switchTo')}
      onClick={() => startTransition(() => router.push(pathname, { locale: other }))}
    >
      {other.toUpperCase()}
    </button>
  );
}

function Dial({
  current,
  title,
  labelFor,
  onPick,
  onClose,
}: {
  current: Edition;
  title: string;
  labelFor: (id: string) => string;
  onPick: (e: Edition) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [onClose]);

  return (
    <div className="dial-pop" ref={ref}>
      <div className="ph">{title}</div>
      <div className="dial-grid">
        {EDITIONS.map((e) => (
          <button
            key={e.id}
            className={`dial-opt ${e.id === current.id ? 'active' : ''}`}
            onClick={() => onPick(e)}
          >
            <span
              className="dial-sw"
              style={{ background: `linear-gradient(135deg, ${e.accent} 50%, ${e.accent2} 50%)` }}
            />
            <span className="nm">{labelFor(e.id)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
