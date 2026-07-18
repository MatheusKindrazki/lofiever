'use client';

import { useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { Ic } from './icons';
import { RisoCover, seedFromId } from './RisoCover';
import { Seismo } from './Seismo';

export interface BroadcastTrack {
  id: string;
  title: string;
  artist: string;
  duration: number;
  bpm?: number;
  mood?: string;
  genre?: string;
  origin?: 'catalog' | 'generated_user' | 'generated_editorial';
  artworkUrl?: string;
}

interface NowPlayingProps {
  track: BroadcastTrack;
  playing: boolean;
  isLoading: boolean;
  onToggle: () => void;
  elapsed: number;
  accent: string;
  accent2: string;
  paper3: string;
  ink: string;
  night: boolean;
  volume: number;
  onVolume: (v: number) => void;
  analyser: AnalyserNode | null;
}

const fmt = (s: number) => {
  const safe = Math.max(0, Math.floor(s || 0));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
};

/* ============================================================
   NOW PLAYING — asymmetric cover block + PLAY postmark
   ============================================================ */
export function NowPlaying({
  track,
  playing,
  isLoading,
  onToggle,
  elapsed,
  accent,
  accent2,
  paper3,
  ink,
  night,
  volume,
  onVolume,
  analyser,
}: NowPlayingProps) {
  const t = useTranslations('player');
  const tBroadcast = useTranslations('broadcast');
  const volRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const setFromEvent = (clientX: number) => {
    if (!volRef.current) return;
    const r = volRef.current.getBoundingClientRect();
    const x = clientX - r.left;
    onVolume(Math.round(Math.max(0, Math.min(1, x / r.width)) * 100));
  };

  useEffect(() => {
    const move = (e: MouseEvent) => {
      if (dragging.current) setFromEvent(e.clientX);
    };
    const up = () => {
      dragging.current = false;
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dur = track.duration || 0;
  const pct = dur ? Math.min(100, (elapsed / dur) * 100) : 0;
  const tags = [track.mood, track.genre, track.bpm ? `${track.bpm} BPM` : null].filter(Boolean) as string[];
  const isConnecting = track.id === 'tuning';
  const isOriginal = track.origin === 'generated_user' || track.origin === 'generated_editorial';

  return (
    <section className="cover-block">
      <div className="np-grid">
        <figure className="cover-art halftone" style={{ margin: 0 }}>
          <RisoCover
            seed={seedFromId(track.id)}
            accent={accent}
            accent2={accent2}
            paper={paper3}
            ink={ink}
            night={night}
            label={isConnecting
              ? tBroadcast('cover.stream')
              : isOriginal
                ? tBroadcast('cover.original')
                : tBroadcast('cover.catalog')}
            artworkUrl={track.artworkUrl}
            alt={`${track.title} — ${track.artist}`}
          />
        </figure>

        <button
          className={`play-stamp ${playing ? '' : 'paused'}`}
          onClick={onToggle}
          aria-label={playing ? t('paused') : t('live')}
        >
          <svg className="ring-text" viewBox="0 0 120 120" aria-hidden="true">
            <defs>
              <path id="bc-ringpath" d="M60,60 m-44,0 a44,44 0 1,1 88,0 a44,44 0 1,1 -88,0" />
            </defs>
            <text fontFamily="var(--font-mono)" fontSize="9.2" letterSpacing="3.1" fill="var(--accent-ink)" fillOpacity="0.9">
              <textPath href="#bc-ringpath">· {tBroadcast('nowPlaying.ring')} </textPath>
            </text>
          </svg>
          {isLoading ? (
            <span
              className="prog-spinner"
              style={{ borderTopColor: 'var(--accent-ink)', borderColor: 'rgba(242,231,206,0.42)' }}
            />
          ) : playing ? (
            <Ic.pause />
          ) : (
            <Ic.play />
          )}
        </button>

        <div className="np-side">
          <div className="np-marker">
            <span>{t('nowPlaying')}</span>
            <span className="np-marker-rule" />
            <span>
              {isConnecting
                ? tBroadcast('nowPlaying.connectingLabel')
                : isOriginal
                ? tBroadcast('nowPlaying.original')
                : tBroadcast('nowPlaying.catalog')}
            </span>
          </div>
          <h2 className="np-title">{track.title}</h2>
          <p className="np-artist">
            {tBroadcast('nowPlaying.by')} <em>{track.artist}</em>
          </p>
          {tags.length > 0 && (
            <div className="np-tags">
              {tags.map((tg) => (
                <span key={tg} className="tag">
                  {tg}
                </span>
              ))}
            </div>
          )}

          <div className="np-transport">
            <div className="timecodes">
              <span>{fmt(elapsed)}</span>
              <span className="tc-mid">{tBroadcast('nowPlaying.duration')} · {fmt(dur)}</span>
              <span className="rem">−{fmt(Math.max(0, dur - elapsed))}</span>
            </div>
            <div className="progress-bar">
              <div className="progress-fill" style={{ width: `${pct}%` }} />
            </div>
            <div className="seismo">
              <Seismo playing={playing} accent={accent} ink={ink} analyser={analyser} />
            </div>
            <div className="vol">
              <span className="lab">{t('volume')}</span>
              <div
                className="vol-track"
                ref={volRef}
                role="slider"
                aria-label={t('volume')}
                aria-valuenow={volume}
                aria-valuemin={0}
                aria-valuemax={100}
                tabIndex={0}
                onMouseDown={(e) => {
                  dragging.current = true;
                  setFromEvent(e.clientX);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowLeft') onVolume(Math.max(0, volume - 5));
                  if (e.key === 'ArrowRight') onVolume(Math.min(100, volume + 5));
                }}
              >
                <div className="vol-fill" style={{ width: `${volume}%` }} />
                <div className="vol-knob" style={{ left: `${volume}%` }} />
              </div>
              <span className="lab" style={{ width: 26, textAlign: 'right' }}>
                {volume}
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export { fmt };
