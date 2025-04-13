'use client';

import { useState, useEffect, useRef } from 'react';
import Image from 'next/image';
import { getStreamData } from '../lib/api';

interface SongInfo {
  id: string;
  title: string;
  artist: string;
  coverUrl: string;
  duration: number;
}

export default function Player() {
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [volume, setVolume] = useState(70);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  
  // State for song info
  const [currentSong, setCurrentSong] = useState<SongInfo | null>(null);
  const [nextUp, setNextUp] = useState<SongInfo[]>([]);

  useEffect(() => {
    let isMounted = true;
    
    async function fetchStreamData() {
      try {
        setLoading(true);
        const data = await getStreamData();
        
        if (isMounted) {
          setCurrentSong(data.currentSong);
          setNextUp(data.nextUp);
          setError(null);
        }
      } catch (err) {
        if (isMounted) {
          setError('Failed to load stream data. Please try again later.');
          console.error('Error fetching stream data:', err);
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }
    
    fetchStreamData();
    
    // Refresh data every 30 seconds
    const intervalId = setInterval(fetchStreamData, 30000);
    
    return () => {
      isMounted = false;
      clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    // In a real app, this would connect to your streaming server
    // For now, we're just using a static audio file
    const audio = new Audio('/mock-lofi.mp3');
    audioRef.current = audio;
    
    audio.addEventListener('timeupdate', updateProgress);
    audio.addEventListener('loadedmetadata', () => {
      setDuration(audio.duration);
    });
    
    return () => {
      audio.pause();
      audio.removeEventListener('timeupdate', updateProgress);
    };
  }, []);

  const updateProgress = () => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime);
    }
  };

  const togglePlayPause = () => {
    if (audioRef.current) {
      if (playing) {
        audioRef.current.pause();
      } else {
        audioRef.current.play().catch(error => {
          console.error("Error playing audio:", error);
          setError("Could not play audio. Please check your audio settings.");
        });
      }
      setPlaying(!playing);
    }
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newVolume = Number.parseInt(e.target.value);
    setVolume(newVolume);
    if (audioRef.current) {
      audioRef.current.volume = newVolume / 100;
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  if (loading) {
    return (
      <div className="w-full max-w-md bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 flex justify-center items-center">
        <div className="animate-pulse-slow text-lofi-500">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
          </svg>
        </div>
        <span className="ml-3 text-lg text-gray-600 dark:text-gray-300">Loading player...</span>
      </div>
    );
  }

  if (error || !currentSong) {
    return (
      <div className="w-full max-w-md bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6">
        <div className="text-center text-red-500">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p>{error || "Could not load music player."}</p>
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
    <div className="w-full max-w-md bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6">
      <div className="flex flex-col items-center">
        <div className="relative w-64 h-64 rounded-lg overflow-hidden shadow-md mb-4">
          <Image 
            src={currentSong.coverUrl} 
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
            <span>{formatTime(duration)}</span>
          </div>
          <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1.5">
            <div 
              className="bg-lofi-500 h-1.5 rounded-full"
              style={{ width: `${(currentTime / duration) * 100}%` }}
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
        
        <div className="flex items-center w-full">
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
        
        {nextUp.length > 0 && (
          <div className="w-full mt-6">
            <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Coming Up Next
            </h3>
            <div className="space-y-2">
              {nextUp.map((song) => (
                <div key={song.id} className="flex items-center p-2 bg-gray-100 dark:bg-gray-700 rounded">
                  <div className="relative w-10 h-10 rounded overflow-hidden">
                    <Image 
                      src={song.coverUrl} 
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
                  <span className="text-xs text-gray-500 dark:text-gray-400">
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