'use client';

import { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';
import { addTrackToQueue, searchTracks } from '@/lib/api';
import type { CatalogTrack } from '@/lib/api';

type QueueStatus =
  | { kind: 'idle' }
  | { kind: 'queuing' }
  | { kind: 'success' }
  | { kind: 'error'; message: string };

const SEARCH_LIMIT = 20;

export function TrackSearch() {
  const t = useTranslations('search');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CatalogTrack[]>([]);
  const [total, setTotal] = useState(0);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [queueStatus, setQueueStatus] = useState<Record<string, QueueStatus>>({});

  const runSearch = useCallback(async (term: string) => {
    setIsSearching(true);
    setSearchError(null);
    try {
      const response = await searchTracks(term, { limit: SEARCH_LIMIT, offset: 0 });
      setResults(response.tracks);
      setTotal(response.meta.total);
      setHasSearched(true);
    } catch (err) {
      console.error('Failed to search tracks:', err);
      setSearchError(t('errors.searchFailed'));
      setResults([]);
      setTotal(0);
      setHasSearched(true);
    } finally {
      setIsSearching(false);
    }
  }, []);

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSearching) return;
    runSearch(query).catch(() => null);
  };

  const handleAddToQueue = useCallback(async (track: CatalogTrack) => {
    setQueueStatus((prev) => ({ ...prev, [track.id]: { kind: 'queuing' } }));
    try {
      await addTrackToQueue(track.id);
      setQueueStatus((prev) => ({ ...prev, [track.id]: { kind: 'success' } }));
    } catch (err) {
      const message = err instanceof Error ? err.message : t('errors.addToQueueFailed');
      setQueueStatus((prev) => ({ ...prev, [track.id]: { kind: 'error', message } }));
    }
  }, []);

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
          {t('title')}
        </h3>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {t('description')}
        </p>
      </div>

      <form onSubmit={handleSubmit} className="flex items-center gap-2">
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('placeholder')}
          className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 p-2 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-lofi-500"
          aria-label={t('title')}
        />
        <button
          type="submit"
          disabled={isSearching}
          className="shrink-0 px-4 py-2 rounded-md bg-lofi-500 text-white text-sm font-medium hover:bg-lofi-600 disabled:bg-lofi-300 disabled:cursor-not-allowed"
        >
          {isSearching ? t('button.searching') : t('button.search')}
        </button>
      </form>

      {searchError && <p className="text-sm text-red-500">{searchError}</p>}

      {hasSearched && !isSearching && !searchError && (
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {total === 0
            ? t('errors.empty')
            : t('count', { count: total })}
        </p>
      )}

      <ul className="space-y-2 max-h-72 overflow-y-auto pr-1">
        {results.map((track) => {
          const status = queueStatus[track.id] ?? { kind: 'idle' as const };
          const isQueuing = status.kind === 'queuing';
          const isQueued = status.kind === 'success';

          return (
            <li
              key={track.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3 shadow-sm"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-gray-900 dark:text-gray-100">
                  {track.title}
                </p>
                <p className="truncate text-xs text-gray-500 dark:text-gray-400">
                  {track.artist}
                  <span className="ml-2 rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-gray-500 dark:bg-gray-700 dark:text-gray-300">
                    {track.sourceType}
                  </span>
                </p>
                {status.kind === 'error' && (
                  <p className="mt-1 text-xs text-red-500">{status.message}</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => handleAddToQueue(track)}
                disabled={isQueuing || isQueued}
                className="shrink-0 px-3 py-1.5 rounded-md bg-lofi-500 text-white text-xs font-medium hover:bg-lofi-600 disabled:cursor-not-allowed disabled:bg-lofi-300"
              >
                {isQueued ? t('button.inQueue') : isQueuing ? t('button.adding') : t('button.addToQueue')}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
