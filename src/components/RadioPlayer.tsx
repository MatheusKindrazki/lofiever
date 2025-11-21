'use client';

import { useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import Image from 'next/image';
import { getStreamData } from '../lib/api';
import { useListeners } from '../lib/socket/client';
import { useUserPreferences } from '../hooks/useUserPreferences';
import { usePlaylistHistory } from '../hooks/usePlaylistHistory';
import { DateNavigator } from './DateNavigator';

interface SongInfo {
  id: string;
  title: string;
  artist: string;
  artworkUrl: string;
  mood?: string;
  duration?: number;
}

interface StreamData {
  currentSong: SongInfo;
  listeners: number;
  nextUp: SongInfo[];
}

interface QueueTrack {
  id: string;
  title: string;
  artist: string;
  mood?: string;
  duration: number;
  addedBy?: string;
}

interface PlaylistData {
  current: QueueTrack | null;
  upcoming: QueueTrack[];
  history: QueueTrack[];
}

export default function RadioPlayer(): React.ReactNode {
  const [playing, setPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isClient, setIsClient] = useState(false);
  const [activeTab, setActiveTab] = useState<'upcoming' | 'history'>('upcoming');
  const [selectedHistoryDate, setSelectedHistoryDate] = useState(new Date());
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const { listenersCount } = useListeners();

  // Use preferences hook for volume persistence
  const { preferences, isLoaded, setVolume: saveVolume } = useUserPreferences();
  const volume = preferences.volume;

  // Use history hook for date-filtered history
  const { history: dailyHistory, stats: historyStats, isLoading: historyLoading } = usePlaylistHistory(selectedHistoryDate);

  // Playlist data
  const [playlistData, setPlaylistData] = useState<PlaylistData>({
    current: null,
    upcoming: [],
    history: [],
  });

  const {
    data: streamData,
    isLoading: queryIsLoading,
    isError,
    error,
  } = useQuery<StreamData>({
    queryKey: ['streamData'],
    queryFn: getStreamData,
    refetchInterval: 15000,
    enabled: isClient,
  });

  const currentSong = streamData?.currentSong;

  // Client-side rendering setup
  useEffect(() => {
    setIsClient(true);
  }, []);

  // Fetch playlist data
  useEffect(() => {
    if (!isClient) return;

    const fetchPlaylist = async () => {
      try {
        const response = await fetch('/api/playlist/queue');
        if (response.ok) {
          const data = await response.json();
          setPlaylistData(data);
        }
      } catch (error) {
        console.error('Failed to fetch playlist:', error);
      }
    };

    fetchPlaylist();
    const interval = setInterval(fetchPlaylist, 30000);
    return () => clearInterval(interval);
  }, [isClient]);

  // Audio setup - Only run once when preferences are loaded
  useEffect(() => {
    if (!isClient || !isLoaded) return; // Wait for preferences to load

    const audio = new Audio();
    audioRef.current = audio;
    audio.volume = volume / 100; // Initial volume from preferences

    const streamUrl = '/api/stream/audio-stream?proxy=true';
    audio.src = streamUrl;
    audio.load();

    const handlePlaying = () => setPlaying(true);
    const handlePause = () => setPlaying(false);
    const handleError = (e: Event) => {
      console.error('Audio error:', e);
      setPlaying(false);
    };

    const handleLoadStart = () => setIsLoading(true);
    const handleCanPlay = () => setIsLoading(false);

    audio.addEventListener('loadstart', handleLoadStart);
    audio.addEventListener('canplay', handleCanPlay);
    audio.addEventListener('playing', handlePlaying);
    audio.addEventListener('pause', handlePause);
    audio.addEventListener('error', handleError);

    audio.play().catch(e => console.warn("Autoplay blocked", e));

    return () => {
      audio.pause();
      audio.removeEventListener('playing', handlePlaying);
      audio.removeEventListener('pause', handlePause);
      audio.removeEventListener('error', handleError);
      audio.removeEventListener('loadstart', handleLoadStart);
      audio.removeEventListener('canplay', handleCanPlay);
    };
  }, [isClient, isLoaded]); // Only re-run when client/loaded state changes

  // Sync volume changes to audio element
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = volume / 100;
    }
  }, [volume]); // Update audio volume whenever preference changes

  const togglePlayPause = () => {
    if (!audioRef.current || !isClient) return;

    if (playing) {
      audioRef.current.pause();
    } else {
      audioRef.current.play().catch(error => {
        console.error("Play error:", error);
      });
    }
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newVolume = Number(e.target.value);
    saveVolume(newVolume); // Save to localStorage via preferences hook
    if (audioRef.current) {
      audioRef.current.volume = newVolume / 100;
    }
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  if (!isClient || queryIsLoading) {
    return (
      <div className="w-full bg-white dark:bg-gray-800 rounded-xl shadow-lg p-4 animate-pulse">
        <div className="flex items-center gap-4 mb-4">
          <div className="w-20 h-20 bg-gray-200 dark:bg-gray-700 rounded-lg"></div>
          <div className="flex-1">
            <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-3/4 mb-2"></div>
            <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-1/2"></div>
          </div>
        </div>
      </div>
    );
  }

  if (isError || !currentSong) {
    return (
      <div className="w-full bg-white dark:bg-gray-800 rounded-xl shadow-lg p-4">
        <p className="text-red-500">Error loading player. {(error as Error)?.message}</p>
      </div>
    );
  }

  return (
    <div className="w-full bg-white dark:bg-gray-800 rounded-xl shadow-lg overflow-hidden h-full flex flex-col">
      {/* Now Playing - Compact Header */}
      <div className="p-4 bg-gradient-to-r from-lofi-500/10 to-purple-500/10 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-4">
          {/* Artwork - Smaller */}
          <div className="relative w-20 h-20 rounded-lg overflow-hidden shadow-md flex-shrink-0">
            <Image
              src={currentSong.artworkUrl}
              alt={`${currentSong.title} by ${currentSong.artist}`}
              fill
              className="object-cover"
              priority
            />
            {/* Play overlay on artwork */}
            <button
              onClick={togglePlayPause}
              className="absolute inset-0 flex items-center justify-center bg-black/30 hover:bg-black/40 transition-colors"
              aria-label={playing ? "Pause" : "Play"}
            >
              {isLoading ? (
                <div className="w-8 h-8 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
              ) : playing ? (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6" />
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                </svg>
              )}
            </button>
          </div>

          {/* Track Info & Controls */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="relative flex h-2 w-2">
                <span className={`absolute inline-flex h-full w-full rounded-full ${playing ? 'bg-green-400 animate-ping' : 'bg-gray-400'} opacity-75`}></span>
                <span className={`relative inline-flex rounded-full h-2 w-2 ${playing ? 'bg-green-500' : 'bg-gray-500'}`}></span>
              </span>
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {playing ? 'Ao vivo' : 'Pausado'}
              </span>
              <span className="text-xs text-gray-400">•</span>
              <span className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                {listenersCount}
              </span>
            </div>

            <h2 className="font-semibold text-gray-900 dark:text-white truncate text-sm">
              {currentSong.title}
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
              {currentSong.artist}
            </p>

            {/* Volume Control - Compact */}
            <div className="flex items-center gap-2 mt-2">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
              </svg>
              <input
                type="range"
                min={0}
                max={100}
                value={volume}
                onChange={handleVolumeChange}
                className="w-full h-1 accent-lofi-500"
                aria-label="Volume"
              />
              <span className="text-xs text-gray-400 w-6">{volume}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200 dark:border-gray-700">
        <button
          onClick={() => setActiveTab('upcoming')}
          className={`flex-1 px-4 py-2 text-xs font-medium transition-colors ${activeTab === 'upcoming'
            ? 'text-lofi-600 dark:text-lofi-400 border-b-2 border-lofi-500'
            : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
            }`}
        >
          Próximas ({playlistData.upcoming.length})
        </button>
        <button
          onClick={() => setActiveTab('history')}
          className={`flex-1 px-4 py-2 text-xs font-medium transition-colors ${activeTab === 'history'
            ? 'text-lofi-600 dark:text-lofi-400 border-b-2 border-lofi-500'
            : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
            }`}
        >
          Histórico ({historyStats?.total || 0})
        </button>
      </div>

      {/* History Date Navigator */}
      {activeTab === 'history' && (
        <div className="px-3 pt-3">
          <DateNavigator
            selectedDate={selectedHistoryDate}
            onDateChange={setSelectedHistoryDate}
          />
          {historyStats && (
            <div className="text-xs text-gray-500 dark:text-gray-400 px-1 py-2 flex items-center justify-between">
              <span>{historyStats.total} músicas</span>
              <span>{Math.floor(historyStats.totalDuration / 60)} min</span>
            </div>
          )}
        </div>
      )}

      {/* Track List */}
      <div className="flex-1 overflow-y-auto p-3 min-h-0">
        {activeTab === 'upcoming' ? (
          playlistData.upcoming.length > 0 ? (
            <div className="space-y-1">
              {playlistData.upcoming.slice(0, 10).map((track, index) => (
                <div
                  key={track.id}
                  className="flex items-center gap-2 p-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
                >
                  <span className="text-xs text-gray-400 w-4">{index + 1}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-gray-800 dark:text-gray-200 truncate">
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
            <p className="text-xs text-gray-500 dark:text-gray-400 text-center py-4">
              Fila vazia - peça músicas no chat!
            </p>
          )
        ) : historyLoading ? (
          <div className="text-center py-8">
            <div className="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-lofi-500"></div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">Carregando histórico...</p>
          </div>
        ) : dailyHistory.length > 0 ? (
          <div className="space-y-1">
            {dailyHistory.map((track) => (
              <div
                key={`${track.id}-${track.playedAt}`}
                className="flex items-center gap-2 p-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors"
              >
                <span className="text-xs text-gray-400 w-12 flex-shrink-0">
                  {new Date(track.playedAt).toLocaleTimeString('pt-BR', {
                    hour: '2-digit',
                    minute: '2-digit'
                  })}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-gray-700 dark:text-gray-300 truncate">
                    {track.title}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                    {track.artist}
                  </p>
                </div>
                <span className="text-xs text-gray-400 flex-shrink-0">
                  {formatDuration(track.duration)}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-gray-500 dark:text-gray-400 text-center py-8">
            Nenhuma música tocou neste dia
          </p>
        )
        }
      </div>
    </div>
  );
}
