'use client';

import { useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import Image from 'next/image';
import { getStreamData } from '../lib/api';
import { usePlaybackSync } from '../lib/socket/client';

// Type for the song info returned from the API
interface SongInfo {
  id: string;
  title: string;
  artist: string;
  artworkUrl: string;
  duration: number;
  streamUrl?: string;
}

// Define the StreamData type that uses SongInfo
interface StreamData {
  currentSong: SongInfo;
  listeners: number;
  daysActive: number;
  songsPlayed: number;
  nextUp: SongInfo[];
}

export default function Player(): React.ReactNode {
  const [playing, setPlaying] = useState(false);
  const [volume, setVolume] = useState(70);
  const [currentTime, setCurrentTime] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  
  // Use React Query for fetching stream data
  const { 
    data: streamData, 
    isLoading, 
    isError, 
    error 
  } = useQuery<StreamData>({
    queryKey: ['streamData'],
    queryFn: getStreamData,
    refetchInterval: 30000, // Refetch every 30 seconds
  });

  // Use the socket sync hook for real-time playback
  const { currentTrack, isPlaying, position, requestSync } = usePlaybackSync();

  // Extract the current song and next up songs from the stream data
  const currentSong = streamData?.currentSong;
  // Limit next up songs to only 2
  const nextUpSongs = streamData?.nextUp?.slice(0, 2) || [];

  useEffect(() => {
    // If we have a current track from Socket.IO sync, use that
    if (currentTrack) {
      // Initialize the audio element with the current track URL
      if (audioRef.current) {
        // Use artworkUrl as proxy for streamUrl to handle the Track type difference
        const streamUrl = currentTrack.artworkUrl || `/api/stream/audio/${currentTrack.id}`;
        audioRef.current.src = streamUrl;
        audioRef.current.currentTime = position / 1000; // Convert position from ms to seconds
        
        if (isPlaying) {
          audioRef.current.play().catch(err => {
            console.error("Error playing audio:", err);
          });
          setPlaying(true);
        } else {
          audioRef.current.pause();
          setPlaying(false);
        }
      }
    }
  }, [currentTrack, position, isPlaying]);

  useEffect(() => {
    // Initialize audio element
    const audio = new Audio();
    audioRef.current = audio;
    
    audio.addEventListener('timeupdate', updateProgress);
    audio.volume = volume / 100;
    
    // Request sync from the server when component mounts
    requestSync();

    return () => {
      audio.pause();
      audio.removeEventListener('timeupdate', updateProgress);
    };
  }, [requestSync, volume]);

  const updateProgress = (): void => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime);
    }
  };

  const togglePlayPause = (): void => {
    if (audioRef.current) {
      if (playing) {
        audioRef.current.pause();
      } else {
        audioRef.current.play().catch(error => {
          console.error("Error playing audio:", error);
        });
      }
      setPlaying(!playing);
      
      // In a real implementation, we would emit an event via Socket.IO
      // to sync the playback state with all clients
    }
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const newVolume = Number.parseInt(e.target.value);
    setVolume(newVolume);
    if (audioRef.current) {
      audioRef.current.volume = newVolume / 100;
    }
  };

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  if (isLoading) {
    return (
      <div className="w-full bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 flex justify-center items-center">
        <div className="animate-pulse-slow text-lofi-500">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
          </svg>
        </div>
        <span className="ml-3 text-lg text-gray-600 dark:text-gray-300">Loading player...</span>
      </div>
    );
  }

  if (isError || !currentSong) {
    return (
      <div className="w-full bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6">
        <div className="text-center text-red-500">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p>{(error as Error)?.message || "Could not load music player."}</p>
          <button 
            onClick={() => window.location.reload()}
            className="mt-4 px-4 py-2 bg-lofi-500 hover:bg-lofi-600 text-white rounded-md"
            type="button"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 h-full flex flex-col overflow-hidden">
      <div className="flex flex-col items-center overflow-hidden">
        <div className="relative w-48 h-48 md:w-56 md:h-56 lg:w-64 lg:h-64 rounded-lg overflow-hidden shadow-md mb-4 flex-shrink-0">
          <Image 
            src={currentSong.artworkUrl} 
            alt={`${currentSong.title} by ${currentSong.artist}`}
            fill
            className="object-cover"
          />
        </div>
        
        <div className="w-full text-center mb-4">
          <h2 className="text-xl font-semibold text-gray-800 dark:text-white truncate">
            {currentSong.title}
          </h2>
          <p className="text-gray-600 dark:text-gray-300">
            {currentSong.artist}
          </p>
        </div>
        
        <div className="w-full mb-4">
          <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mb-1">
            <span>{formatTime(currentTime)}</span>
            <span>{formatTime(currentSong.duration)}</span>
          </div>
          <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1.5">
            <div 
              className="bg-lofi-500 h-1.5 rounded-full"
              style={{ width: `${(currentTime / currentSong.duration) * 100}%` }}
            />
          </div>
        </div>
        
        <div className="flex items-center justify-center w-full mb-4">
          <button 
            onClick={togglePlayPause}
            className="bg-lofi-500 hover:bg-lofi-600 text-white rounded-full p-4 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-lofi-400"
            aria-label={playing ? "Pause" : "Play"}
            type="button"
          >
            {playing ? (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            )}
          </button>
        </div>
        
        <div className="flex items-center w-full mb-4">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-gray-500 dark:text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15.536a5 5 0 001.415-7.072m-2.829 9.9a9 9 0 010-12.728" />
          </svg>
          <input
            type="range"
            min={0}
            max={100}
            value={volume}
            onChange={handleVolumeChange}
            className="w-full mx-2 accent-lofi-500"
            aria-label="Volume control"
          />
          <span className="text-xs text-gray-500 dark:text-gray-400 w-8">{volume}%</span>
        </div>
        
        {nextUpSongs.length > 0 && (
          <div className="w-full mt-2 flex-1 overflow-auto">
            <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Coming Up Next
            </h3>
            <div className="space-y-2 overflow-auto">
              {nextUpSongs.map((song) => (
                <div key={song.id} className="flex items-center p-2 bg-gray-100 dark:bg-gray-700 rounded">
                  <div className="relative w-10 h-10 rounded overflow-hidden flex-shrink-0">
                    <Image 
                      src={song.artworkUrl} 
                      alt={song.title}
                      fill
                      className="object-cover"
                    />
                  </div>
                  <div className="ml-3 flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                      {song.title}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                      {song.artist}
                    </p>
                  </div>
                  <span className="text-xs text-gray-500 dark:text-gray-400 flex-shrink-0">
                    {formatTime(song.duration)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
} 