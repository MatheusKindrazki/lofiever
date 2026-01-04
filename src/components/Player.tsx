'use client';

import { useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import Image from 'next/image';
import { getStreamData } from '../lib/api';
import { useUserPreferences } from '../hooks/useUserPreferences';

// As interfaces foram movidas para um arquivo de tipos, mas as mantemos aqui para referência
interface SongInfo {
  id: string;
  title: string;
  artist: string;
  artworkUrl: string;
}

interface StreamData {
  currentSong: SongInfo;
  listeners: number;
  nextUp: SongInfo[];
}

export default function Player(): React.ReactNode {
  const [playing, setPlaying] = useState(false);
  const [, setIsLoading] = useState(true);
  const [isClient, setIsClient] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Use preferences hook for volume persistence
  const { preferences, isLoaded, setVolume: saveVolume } = useUserPreferences();
  const volume = preferences.volume;

  const {
    data: streamData,
    isLoading: queryIsLoading,
    isError,
    error,
  } = useQuery<StreamData>({
    queryKey: ['streamData'],
    queryFn: getStreamData,
    refetchInterval: 15000, // Refetch a cada 15 segundos para metadados atualizados
    enabled: isClient,
  });

  const currentSong = streamData?.currentSong;
  const nextUpSongs = streamData?.nextUp?.slice(0, 2) || [];

  // Efeito para rodar apenas no lado do cliente
  useEffect(() => {
    setIsClient(true);
  }, []);

  // Efeito para configurar o player de áudio - Only run once when preferences load
  useEffect(() => {
    if (!isClient || !isLoaded) return; // Wait for preferences to load

    const audio = new Audio();
    audioRef.current = audio;
    // O volume é definido no handleVolumeChange, mas podemos setar um inicial aqui também
    audio.volume = volume / 100; // Initial volume from preferences

    // URL do stream ao vivo
    const streamUrl = '/api/stream/audio-stream?proxy=true';
    audio.src = streamUrl;
    audio.load(); // Carrega o stream

    const handlePlaying = () => setPlaying(true);
    const handlePause = () => setPlaying(false);
    const handleError = (e: Event) => {
      console.error('🚨 Erro no elemento de áudio:', e);
      setPlaying(false);
    };

    const handleLoadStart = () => setIsLoading(true);
    const handleCanPlay = () => setIsLoading(false);
    audio.addEventListener('loadstart', handleLoadStart);
    audio.addEventListener('canplay', handleCanPlay);

    audio.addEventListener('playing', handlePlaying);
    audio.addEventListener('pause', handlePause);
    audio.addEventListener('error', handleError);

    // Tenta tocar assim que possível (muitos navegadores exigem interação do usuário)
    audio.play().catch(e => console.warn("A reprodução automática foi bloqueada.", e));

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
      // O 'src' já está definido para o stream, então apenas tocamos.
      audioRef.current.play().catch(error => {
        console.error("❌ Erro ao tentar tocar o stream:", error);
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

  // Renderização de estado de carregamento
  if (!isClient || queryIsLoading) {
    // ... (mesmo código de carregamento de antes)
    return (
      <div className="w-full bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 flex justify-center items-center">
        <p>Loading Player...</p>
      </div>
    )
  }

  // Renderização de estado de erro
  if (isError || !currentSong) {
    // ... (mesmo código de erro de antes)
    return (
      <div className="w-full bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6">
        <p>Error loading player. {(error as Error)?.message}</p>
      </div>
    )
  }

  return (
    <div className="w-full bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 h-full flex flex-col overflow-hidden">
      <div className="flex flex-col items-center overflow-hidden">
        <div className="relative w-64 h-64 rounded-lg overflow-hidden shadow-md mb-4 flex-shrink-0">
          <Image
            src={currentSong.artworkUrl}
            alt={`${currentSong.title} by ${currentSong.artist}`}
            fill
            className="object-cover"
            priority
          />
        </div>

        <div className="w-full text-center mb-4">
          <h2 className="text-xl font-semibold text-gray-800 dark:text-white truncate">
            {currentSong.title}
          </h2>
          <p className="text-gray-600 dark:text-gray-300">{currentSong.artist}</p>
        </div>

        <div className="flex items-center justify-center w-full mb-4">
          <button
            onClick={togglePlayPause}
            className="bg-lofi-500 hover:bg-lofi-600 text-white rounded-full p-4 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-lofi-400"
            aria-label={playing ? "Pause" : "Play"}
            type="button"
          >
            {/* Ícones de Play/Pause */}
            {playing ? (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6" /></svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" /></svg>
            )}
          </button>
        </div>

        <div className="flex items-center w-full mb-4">
          {/* Controle de Volume */}
          <input
            type="range"
            min={0}
            max={100}
            value={volume}
            onChange={handleVolumeChange}
            className="w-full mx-2 accent-lofi-500"
            aria-label="Volume control"
          />
        </div>

        {/* Lista de Próximas Músicas */}
        {nextUpSongs.length > 0 && (
          <div className="w-full mt-2 flex-1 overflow-auto">
            {/* ... (mesmo código de 'nextUp' de antes) ... */}
          </div>
        )}
      </div>
    </div>
  );
}