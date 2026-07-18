'use client';

import { useCallback, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { usePlaylistQueue } from '@/hooks/usePlaylistQueue';
import { usePlaylistHistory } from '@/hooks/usePlaylistHistory';
import { addTrackToQueue, ApiError } from '@/lib/api';
import type { CatalogTrack } from '@/lib/api';
import { searchCatalogWithFallback } from '@/lib/catalog-search';
import type { BroadcastTrack } from './NowPlaying';
import { fmt } from './NowPlaying';
import { Ic } from './icons';

interface ProgramProps {
  /** current track from socket sync, used to highlight NOW */
  current: BroadcastTrack | null;
}

/* ============================================================
   PROGRAM — live setlist + localized history
   ============================================================ */
export function Program({ current }: ProgramProps) {
  const t = useTranslations('player');
  const localeLabel = useTranslations('search');
  const tBroadcast = useTranslations('broadcast');
  const locale = useLocale();
  const [tab, setTab] = useState<'program' | 'archive' | 'catalog'>('program');
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());

  const { data: queue } = usePlaylistQueue();
  const upcoming = queue?.upcoming ?? [];

  const { history, isLoading: historyLoading } = usePlaylistHistory(selectedDate);

  const isToday = selectedDate.toDateString() === new Date().toDateString();
  const dayLabel = (() => {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    if (selectedDate.toDateString() === today.toDateString()) return tBroadcast('program.today');
    if (selectedDate.toDateString() === yesterday.toDateString()) return tBroadcast('program.yesterday');
    return selectedDate
      .toLocaleDateString(locale === 'en' ? 'en-US' : 'pt-BR', { day: '2-digit', month: 'short' })
      .toUpperCase();
  })();

  const changeDate = (deltaDays: number) => {
    const next = new Date(selectedDate);
    next.setDate(next.getDate() + deltaDays);
    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);
    if (next <= endOfToday) setSelectedDate(next);
  };

  return (
    <section className="panel">
      <div className="prog-tabs">
        <button
          className={`prog-tab ${tab === 'program' ? 'active' : ''}`}
          onClick={() => setTab('program')}
        >
          {tBroadcast('program.upNext')}
        </button>
        <button
          className={`prog-tab ${tab === 'archive' ? 'active' : ''}`}
          onClick={() => setTab('archive')}
        >
          {tBroadcast('program.history')}
        </button>
        <button
          className={`prog-tab ${tab === 'catalog' ? 'active' : ''}`}
          onClick={() => setTab('catalog')}
        >
          {localeLabel('title')}
        </button>
      </div>

      {tab === 'catalog' ? (
        <CatalogRequest />
      ) : tab === 'program' ? (
        <>
          <div className="prog-list">
            {current && (
              <div className="prog-row now">
                <span className="prog-idx">{tBroadcast('program.now')}</span>
                <div className="prog-meta">
                  <div className="t">{current.title}</div>
                  <div className="a">{current.artist}</div>
                </div>
                <span className="prog-dur">{fmt(current.duration)}</span>
              </div>
            )}
            {upcoming.length > 0 ? (
              upcoming.slice(0, 15).map((tr, i) => (
                <div className="prog-row" key={tr.id}>
                  <span className="prog-idx">{String(i + 1).padStart(2, '0')}</span>
                  <div className="prog-meta">
                    <div className="t">{tr.title}</div>
                    <div className="a">{tr.artist}</div>
                  </div>
                  <span className="prog-dur">{fmt(tr.duration)}</span>
                </div>
              ))
            ) : !current ? (
              <div className="prog-empty">{t('emptyQueue')}</div>
            ) : null}
          </div>
          <div className="no-skip">↻ {tBroadcast('program.shared')}</div>
        </>
      ) : (
        <>
          <div className="date-nav">
            <button onClick={() => changeDate(-1)} aria-label={tBroadcast('program.older')}>
              <Ic.left />
            </button>
            <span className="d">{dayLabel}</span>
            <button onClick={() => changeDate(1)} disabled={isToday} aria-label={tBroadcast('program.newer')}>
              <Ic.right />
            </button>
          </div>
          <div className="prog-list">
            {historyLoading ? (
              <div className="prog-loading">
                <span className="prog-spinner" />
              </div>
            ) : history.length > 0 ? (
              history.map((h) => (
                <div className="prog-row" key={`${h.id}-${String(h.playedAt)}`}>
                  <span className="prog-idx" style={{ fontSize: 11, width: 44 }}>
                    {new Date(h.playedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <div className="prog-meta">
                    <div className="t">{h.title}</div>
                    <div className="a">{h.artist}</div>
                  </div>
                  <span className="prog-dur">{fmt(h.duration)}</span>
                </div>
              ))
            ) : (
              <div className="prog-empty">{t('emptyHistory')}</div>
            )}
          </div>
        </>
      )}
    </section>
  );
}

type QueueStatus =
  | { kind: 'idle' }
  | { kind: 'queuing' }
  | { kind: 'success' }
  | { kind: 'error'; message: string };

function CatalogRequest() {
  const t = useTranslations('search');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CatalogTrack[]>([]);
  const [total, setTotal] = useState(0);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [fallbackQuery, setFallbackQuery] = useState<string | null>(null);
  const [queueStatus, setQueueStatus] = useState<Record<string, QueueStatus>>({});

  const runSearch = useCallback(async (term: string) => {
    setIsSearching(true);
    setSearchError(null);
    setFallbackQuery(null);
    try {
      const response = await searchCatalogWithFallback(term);
      setResults(response.tracks);
      setTotal(response.exactTotal);
      setFallbackQuery(response.isFallback ? term : null);
      setHasSearched(true);
    } catch (error) {
      console.error('Failed to search tracks:', error);
      setSearchError(t('errors.searchFailed'));
      setResults([]);
      setTotal(0);
      setHasSearched(true);
    } finally {
      setIsSearching(false);
    }
  }, [t]);

  const addToProgram = useCallback(async (track: CatalogTrack) => {
    setQueueStatus((previous) => ({ ...previous, [track.id]: { kind: 'queuing' } }));
    try {
      await addTrackToQueue(track.id);
      setQueueStatus((previous) => ({ ...previous, [track.id]: { kind: 'success' } }));
    } catch (error) {
      const message = error instanceof ApiError && error.status === 401
        ? t('errors.authenticationRequired')
        : error instanceof ApiError && error.status === 429
          ? t('errors.rateLimited')
        : error instanceof Error
          ? error.message
          : t('errors.addToQueueFailed');
      setQueueStatus((previous) => ({ ...previous, [track.id]: { kind: 'error', message } }));
    }
  }, [t]);

  return (
    <div className="catalog-search">
      <p className="catalog-intro">{t('description')}</p>
      <form
        className="catalog-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!isSearching && query.trim()) runSearch(query.trim()).catch(() => null);
        }}
      >
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('placeholder')}
          aria-label={t('title')}
        />
        <button type="submit" disabled={isSearching || !query.trim()}>
          {isSearching ? t('button.searching') : t('button.search')}
        </button>
      </form>

      {searchError && <p className="catalog-feedback error" role="alert">{searchError}</p>}
      {hasSearched && !isSearching && !searchError && (
        <p className={`catalog-feedback ${fallbackQuery ? 'fallback' : ''}`} aria-live="polite">
          {fallbackQuery
            ? t('fallback', { query: fallbackQuery })
            : total === 0
              ? t('errors.empty')
              : t('count', { count: total })}
        </p>
      )}

      <ul className="catalog-results">
        {results.map((track) => {
          const status = queueStatus[track.id] ?? { kind: 'idle' as const };
          return (
            <li className="catalog-row" key={track.id}>
              <div className="catalog-meta">
                <span className="title">{track.title}</span>
                <span className="artist">
                  {track.artist} · {track.mood || t('catalogLabel')}
                </span>
                {status.kind === 'error' && <span className="error">{status.message}</span>}
              </div>
              <button
                type="button"
                onClick={() => addToProgram(track)}
                disabled={status.kind === 'queuing' || status.kind === 'success'}
              >
                {status.kind === 'success'
                  ? t('button.inQueue')
                  : status.kind === 'queuing'
                    ? t('button.adding')
                    : t('button.addToQueue')}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
