'use client';

import { useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import Image from 'next/image';
import { getStreamData } from '../lib/api';
import { usePlaybackSync } from '../lib/socket/client';
import { useAudioStream } from '../services/audioStream/streamService';

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
  const [isLoading, setIsLoading] = useState(true);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  
  // Use React Query for fetching stream data
  const { 
    data: streamData, 
    isLoading: queryIsLoading, 
    isError, 
    error 
  } = useQuery<StreamData>({
    queryKey: ['streamData'],
    queryFn: getStreamData,
    refetchInterval: 30000, // Refetch every 30 seconds
  });

  // Use the socket sync hook for real-time playback (for future metadata sync)
  const { requestSync } = usePlaybackSync();
  
  // Use the audio stream service
  const { getStreamUrl, metadata: streamMetadata } = useAudioStream();

  // Extract the current song and next up songs from the stream data
  // Use stream metadata if available, otherwise fall back to API data
  const currentSong = streamData?.currentSong ? {
    ...streamData.currentSong,
    title: streamMetadata.title || streamData.currentSong.title,
    artist: streamMetadata.artist || streamData.currentSong.artist,
  } : streamData?.currentSong;
  
  // Limit next up songs to only 2
  const nextUpSongs = streamData?.nextUp?.slice(0, 2) || [];

  useEffect(() => {
    // Initialize audio element only once
    const audio = new Audio();
    audioRef.current = audio;
    
    // Set initial volume
    audio.volume = volume / 100;
    
    // Set up audio event listeners
    const handleLoadStart = (): void => console.log('🎵 Stream loading started');
    const handleCanPlay = (): void => {
      console.log('🎵 Stream can play');
      setIsLoading(false);
    };
    const handleLoadedData = (): void => console.log('🎵 Stream loaded data');
    const handleProgress = (): void => console.log('🎵 Stream progress');
    const handlePlaying = (): void => console.log('🎵 Stream playing');
    const handlePause = (): void => console.log('🎵 Stream paused');
    const handleEnded = (): void => console.log('🎵 Stream ended');
    const handleError = (e: Event): void => {
      console.error('🚨 Stream error:', e);
      const target = e.target as HTMLAudioElement;
      console.error('🚨 Error details:', {
        error: target.error,
        networkState: target.networkState,
        readyState: target.readyState,
        src: target.src
      });
      
      // Fallback to example file if stream fails
      if (audio.src.includes('localhost:3000/api/stream/audio-stream')) {
        console.log('🔄 Stream failed, falling back to local file');
        audio.src = '/music/example.mp3';
        audio.load();
      }
    };
    const handleTimeUpdate = (): void => {
      setCurrentTime(audio.currentTime);
    };
    
    audio.addEventListener('loadstart', handleLoadStart);
    audio.addEventListener('canplay', handleCanPlay);
    audio.addEventListener('loadeddata', handleLoadedData);
    audio.addEventListener('progress', handleProgress);
    audio.addEventListener('playing', handlePlaying);
    audio.addEventListener('pause', handlePause);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('error', handleError);
    audio.addEventListener('timeupdate', handleTimeUpdate);
    
    // Get stream URL and set it
    // Temporary: Use local file first to test basic functionality
    console.log('🎯 Using local MP3 file for testing');
    audio.src = '/music/example.mp3';
    
    // Check if browser supports the file format
    const canPlayMp3 = audio.canPlayType('audio/mpeg');
    console.log('🎵 Browser MP3 support:', canPlayMp3);
    
    console.log('🎵 Local file set, waiting for user interaction');
    
    /* Original stream code - temporarily disabled
    getStreamUrl().then(url => {
      console.log('🎯 Setting stream URL:', url);
      audio.src = url;
      
      // Check if browser supports the stream format
      const canPlay = audio.canPlayType('audio/ogg; codecs="opus"');
      console.log('🎵 Browser Opus support:', canPlay);
      
      // Don't auto-load to avoid autoplay issues
      // audio.load(); 
      console.log('🎵 Stream URL set, waiting for user interaction');
    }).catch(error => {
      console.error('❌ Failed to get stream URL:', error);
      audio.src = '/music/example.mp3';
      // audio.load();
    });
    */
    
    // Request sync from the server when component mounts
    requestSync();

    return () => {
      audio.pause();
      audio.removeEventListener('loadstart', handleLoadStart);
      audio.removeEventListener('canplay', handleCanPlay);
      audio.removeEventListener('loadeddata', handleLoadedData);
      audio.removeEventListener('progress', handleProgress);
      audio.removeEventListener('playing', handlePlaying);
      audio.removeEventListener('pause', handlePause);
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('error', handleError);
      audio.removeEventListener('timeupdate', handleTimeUpdate);
    };
  }, [requestSync, getStreamUrl]);

  // Separate effect for volume changes
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = volume / 100;
    }
  }, [volume]);

  const togglePlayPause = (): void => {
    if (audioRef.current) {
      if (playing) {
        audioRef.current.pause();
        setPlaying(false);
      } else {
        console.log('🎵 Attempting to play audio:', audioRef.current.src);
        
        // Load the stream if not already loaded
        if (audioRef.current.readyState === 0) {
          console.log('🔄 Loading stream for first time...');
          audioRef.current.load();
        }
        
        audioRef.current.play()
          .then(() => {
            console.log('✅ Audio play started successfully');
            setPlaying(true);
          })
          .catch(error => {
            console.error("❌ Error playing audio:", error);
            console.log('🔄 Trying fallback file...');
            
            // Try fallback file if stream fails
            if (audioRef.current) {
              audioRef.current.src = '/music/example.mp3';
              audioRef.current.load();
              
              return audioRef.current.play();
            }
            
            return Promise.reject(new Error('Audio element not available'));
          })
          .then(() => {
            console.log('✅ Fallback audio started successfully');
            setPlaying(true);
          })
          .catch(error => {
            console.error("❌ Fallback audio also failed:", error);
            setPlaying(false);
          });
      }
    }
  };

  const testStreamDirectly = async (): Promise<void> => {
    try {
      const streamUrl = await getStreamUrl();
      console.log('🧪 Testing stream directly:', streamUrl);
      
      if (audioRef.current) {
        audioRef.current.src = streamUrl;
        audioRef.current.load();
        
        // Try to play after a short delay
        setTimeout(async () => {
          try {
            await audioRef.current?.play();
            console.log('✅ Direct stream test successful');
          } catch (error) {
            console.error('❌ Direct stream test failed:', error);
          }
        }, 1000);
      }
    } catch (error) {
      console.error('❌ Stream test error:', error);
    }
  };

  const testFallbackFile = (): void => {
    console.log('🧪 Testing fallback file');
    if (audioRef.current) {
      audioRef.current.src = '/music/example.mp3';
      audioRef.current.load();
      
      setTimeout(async () => {
        try {
          await audioRef.current?.play();
          console.log('✅ Fallback file test successful');
        } catch (error) {
          console.error('❌ Fallback file test failed:', error);
        }
      }, 1000);
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

  if (isLoading || queryIsLoading) {
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
        
        <div className="flex items-center justify-center w-full mb-4 gap-2">
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
          
          {/* Debug buttons - remove in production */}
          <button 
            onClick={testStreamDirectly}
            className="bg-blue-500 hover:bg-blue-600 text-white rounded px-3 py-1 text-xs focus:outline-none"
            type="button"
            title="Test Stream"
          >
            🧪 Stream
          </button>
          <button 
            onClick={testFallbackFile}
            className="bg-green-500 hover:bg-green-600 text-white rounded px-3 py-1 text-xs focus:outline-none"
            type="button"
            title="Test Local File"
          >
            🧪 Local
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