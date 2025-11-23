'use client';

import { usePlaybackSync, useListeners } from '../lib/socket/client';
import { usePlaylistQueue } from '@/hooks/usePlaylistQueue';

export default function PlaylistInfo() {
  const { currentTrack } = usePlaybackSync();
  const { listenersCount } = useListeners();
  const { data: playlistData, isLoading, refetch, isFetching } = usePlaylistQueue();

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  if (isLoading) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-4 animate-pulse">
        <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-24 mb-4"></div>
        <div className="space-y-3">
          <div className="h-12 bg-gray-200 dark:bg-gray-700 rounded"></div>
          <div className="h-12 bg-gray-200 dark:bg-gray-700 rounded"></div>
        </div>
      </div>
    );
  }

  const upcoming = playlistData?.upcoming || [];
  const history = playlistData?.history || [];

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg overflow-hidden h-full flex flex-col">
      {/* Now Playing */}
      <div className="p-4 bg-gradient-to-r from-lofi-500/10 to-purple-500/10 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
            </span>
            <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
              Tocando agora
            </span>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <span>{listenersCount}</span>
            </div>
            <button
              onClick={() => refetch()}
              disabled={isFetching}
              className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
              title="Atualizar fila"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
          </div>
        </div>
        {currentTrack ? (
          <div>
            <p className="font-semibold text-gray-900 dark:text-white truncate">
              {currentTrack.title}
            </p>
            <p className="text-sm text-gray-500 dark:text-gray-400 truncate">
              {currentTrack.artist}
            </p>
            <div className="flex items-center gap-2 mt-2">
              {currentTrack.mood && (
                <span className="text-xs bg-purple-100 dark:bg-purple-900/50 text-purple-700 dark:text-purple-300 px-2 py-0.5 rounded-full">
                  {currentTrack.mood}
                </span>
              )}
              {currentTrack.bpm && (
                <span className="text-xs text-gray-400">
                  {currentTrack.bpm} BPM
                </span>
              )}
            </div>
          </div>
        ) : (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Carregando...
          </p>
        )}
      </div>

      {/* Scrollable content area */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {/* Up Next */}
        <div className="p-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
              Próximas
            </span>
            <span className="text-xs text-gray-400">
              {upcoming.length} na fila
            </span>
          </div>
          {upcoming.length > 0 ? (
            <div className="space-y-2">
              {upcoming.slice(0, 5).map((track, index) => (
                <div
                  key={track.id}
                  className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
                >
                  <span className="text-xs text-gray-400 w-4">{index + 1}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">
                      {track.title}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                      {track.artist}
                    </p>
                  </div>
                  <span className="text-xs text-gray-400">
                    {formatDuration(track.duration)}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-2">
              Fila vazia - peça músicas!
            </p>
          )}
        </div>

        {/* Recently Played */}
        <div className="p-4">
          <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
            Tocadas recentemente
          </span>
          {history.length > 0 ? (
            <div className="mt-3 space-y-2">
              {history.slice(0, 5).map((track) => (
                <div
                  key={track.id}
                  className="flex items-center gap-3 p-2 rounded-lg opacity-60"
                >
                  <span className="text-xs text-gray-400">♪</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-600 dark:text-gray-400 truncate">
                      {track.title}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-500 truncate">
                      {track.artist}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-2 mt-3">
              Nenhuma música tocada ainda
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
