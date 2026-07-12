'use client';

import { useTranslations } from 'next-intl';
import { Ic } from './icons';
import { RisoCover, seedFromId } from './RisoCover';
import { Seismo } from './Seismo';
import type { BroadcastTrack } from './NowPlaying';
import { fmt } from './NowPlaying';

interface ZenBroadcastProps {
  track: BroadcastTrack;
  issueNo: number;
  playing: boolean;
  isLoading: boolean;
  onToggle: () => void;
  onExit: () => void;
  elapsed: number;
  accent: string;
  accent2: string;
  paper3: string;
  ink: string;
  night: boolean;
  analyser: AnalyserNode | null;
}

/* ============================================================
   ZEN — the edition, full bleed. Cover, title, seismograph.
   ============================================================ */
export function ZenBroadcast({
  track,
  issueNo,
  playing,
  isLoading,
  onToggle,
  onExit,
  elapsed,
  accent,
  accent2,
  paper3,
  ink,
  night,
  analyser,
}: ZenBroadcastProps) {
  const t = useTranslations('player');
  const num = (issueNo % 999) + 1;

  return (
    <div className="zen halftone">
      <div className="zen-wash" />
      <button className="chip icon-only zen-exit" onClick={onExit} aria-label={t('zenMode.exit')}>
        <Ic.close />
      </button>
      <div className="zen-inner">
        <div className="zen-art">
          <RisoCover
            seed={seedFromId(track.id)}
            accent={accent}
            accent2={accent2}
            paper={paper3}
            ink={ink}
            night={night}
            num={num}
            artworkUrl={track.artworkUrl}
            alt={`${track.title} — ${track.artist}`}
          />
        </div>
        <h2 className="zen-title">{track.title}</h2>
        <p className="zen-artist">{track.artist}</p>
        <div className="zen-seismo">
          <Seismo playing={playing} accent={accent} ink={ink} bars={72} analyser={analyser} />
        </div>
        <div className="zen-bottom">
          <button
            className={`play-stamp ${playing ? '' : 'paused'}`}
            onClick={onToggle}
            aria-label={playing ? t('paused') : t('live')}
          >
            {isLoading ? (
              <span
                className="prog-spinner"
                style={{ borderTopColor: '#fff', borderColor: 'rgba(255,255,255,0.4)' }}
              />
            ) : playing ? (
              <Ic.pause />
            ) : (
              <Ic.play />
            )}
          </button>
          <div className="zen-stats">
            <span>
              <b>{fmt(elapsed)}</b> / {fmt(track.duration)}
            </span>
            <span>88.3 FM</span>
            <span>
              <b>{playing ? t('live') : t('paused')}</b>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
