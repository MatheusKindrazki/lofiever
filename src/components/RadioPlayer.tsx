'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import Image from 'next/image';
import { useListeners, usePlaybackSync } from '../lib/socket/client';
import { useUserPreferences } from '../hooks/useUserPreferences';
import { usePlaylistHistory } from '../hooks/usePlaylistHistory';
import { DateNavigator } from './DateNavigator';
import {
    PlayIcon,
    PauseIcon,
    SpeakerWaveIcon,
    ClockIcon,
    UsersIcon,
    CalendarIcon,
    MusicalNoteIcon,
} from '@heroicons/react/24/solid';

// Types
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

// Main Component
export default function RadioPlayer({ zen = false }: { zen?: boolean }): React.ReactNode {
    const t = useTranslations('player');
    const [playing, setPlaying] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [isClient, setIsClient] = useState(false);
    const [activeTab, setActiveTab] = useState<'upcoming' | 'history'>('upcoming');
    const [selectedHistoryDate, setSelectedHistoryDate] = useState(new Date());

    const audioRef = useRef<HTMLAudioElement | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
    const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);

    const { listenersCount } = useListeners();
    const { currentTrack: syncedTrack } = usePlaybackSync();
    const { preferences, isLoaded, setVolume: saveVolume } = useUserPreferences();
    const volume = preferences.volume;
    const { history: dailyHistory, isLoading: historyLoading } = usePlaylistHistory(selectedHistoryDate);

    const [playlistData, setPlaylistData] = useState<PlaylistData>({
        current: null,
        upcoming: [],
        history: [],
    });

    const currentSong = syncedTrack || playlistData.current;

    useEffect(() => {
        setIsClient(true);
    }, []);

    useEffect(() => {
        if (!isClient) return;

        const fetchPlaylist = async () => {
            try {
                const response = await fetch('/api/playlist/queue');
                if (response.ok) setPlaylistData(await response.json());
            } catch (error) {
                console.error('Failed to fetch playlist:', error);
            }
        };

        fetchPlaylist();
        const interval = setInterval(fetchPlaylist, 30000);

        // Re-fetch when tab becomes visible again (browser throttles intervals in background)
        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                fetchPlaylist();
            }
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);

        return () => {
            clearInterval(interval);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
    }, [isClient]);

    const setupAudio = useCallback(() => {
        if (!isClient || !isLoaded || audioRef.current) return;

        const audio = new Audio();
        audioRef.current = audio;
        audio.crossOrigin = 'anonymous';
        audio.volume = volume / 100; // Initial volume from preferences
        audio.src = '/api/stream/audio-stream?proxy=true';
        audio.load();

        const handlePlaying = () => setPlaying(true);
        const handlePause = () => setPlaying(false);
        const handleError = (e: Event) => console.error('Audio error:', e);
        const handleLoadStart = () => setIsLoading(true);
        const handleCanPlay = () => setIsLoading(false);

        audio.addEventListener('playing', handlePlaying);
        audio.addEventListener('pause', handlePause);
        audio.addEventListener('error', handleError);
        audio.addEventListener('loadstart', handleLoadStart);
        audio.addEventListener('canplay', handleCanPlay);

        audio.play().catch(e => console.warn("Autoplay blocked", e));

        return () => {
            audio.pause();
            audio.removeEventListener('playing', handlePlaying);
            audio.removeEventListener('pause', handlePause);
            audio.removeEventListener('error', handleError);
            audio.removeEventListener('loadstart', handleLoadStart);
            audio.removeEventListener('canplay', handleCanPlay);
            sourceRef.current?.disconnect();
            audioContextRef.current?.close();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isClient, isLoaded]); // Don't include volume - it's updated separately

    useEffect(() => {
        const cleanup = setupAudio();
        return cleanup;
    }, [setupAudio]);


    const initAudioContext = () => {
        if (!audioRef.current || audioContextRef.current) return;

        try {
            const context = new (window.AudioContext || (window as any).webkitAudioContext)();
            audioContextRef.current = context;
            const analyserNode = context.createAnalyser();
            analyserNode.fftSize = 256;
            setAnalyser(analyserNode);

            if (!sourceRef.current) {
                sourceRef.current = context.createMediaElementSource(audioRef.current);
            }
            sourceRef.current.connect(analyserNode);
            analyserNode.connect(context.destination);
        } catch (error) {
            console.error("Failed to initialize AudioContext:", error);
        }
    };


    useEffect(() => {
        if (audioRef.current) {
            audioRef.current.volume = volume / 100;
        }
    }, [volume]);

    const togglePlayPause = () => {
        if (!audioRef.current) return;
        if (playing) {
            audioRef.current.pause();
        } else {
            // Reload stream to get latest buffer (it's a live radio, need to sync)
            setIsLoading(true);
            audioRef.current.src = '/api/stream/audio-stream?proxy=true&t=' + Date.now();
            audioRef.current.load();
            initAudioContext();
            audioRef.current.play().catch(e => {
                console.error("Play error:", e);
                setIsLoading(false);
            });
        }
    };

    const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const newVolume = Number(e.target.value);
        saveVolume(newVolume);
    };

    const formatDuration = (seconds: number) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    if (!isClient) {
        return <div className="w-full h-full flex items-center justify-center bg-slate-900 rounded-2xl"><div className="w-16 h-16 border-4 border-white/20 border-t-lofi-500 rounded-full animate-spin"></div></div>;
    }

    if (!currentSong) {
        return (
            <div className="w-full h-full flex flex-col items-center justify-center text-center bg-slate-900 rounded-2xl p-4">
                <MusicalNoteIcon className="w-12 h-12 text-lofi-500/50 mb-4" />
                <h3 className="font-semibold text-white mb-1">Aguardando a próxima faixa...</h3>
                <p className="text-sm text-slate-400">A playlist está sendo preparada.</p>
            </div>
        );
    }

    const playerProps = {
        t,
        currentSong,
        playing,
        isLoading,
        togglePlayPause,
        volume,
        handleVolumeChange,
        listenersCount,
        playlistData,
        activeTab,
        setActiveTab,
        historyLoading,
        dailyHistory,
        selectedHistoryDate,
        setSelectedHistoryDate,
        formatDuration,
        analyser,
    };

    return zen ? <ZenPlayer {...playerProps} /> : <StandardPlayer {...playerProps} />;
}

// Zen Player Layout
const ZenPlayer = (props: any) => {
    const { t, currentSong, playing, isLoading, togglePlayPause, volume, handleVolumeChange, listenersCount, analyser } = props;

    return (
        <div className="relative w-full h-full flex flex-col items-center justify-center text-center">
            {/* Glow effect pulsante behind album */}
            <div className={`absolute inset-0 pointer-events-none ${playing ? 'animate-pulse-slow' : ''}`}>
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] h-[400px] bg-purple-500/30 rounded-full blur-[80px]"></div>
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[250px] h-[250px] bg-lofi-500/40 rounded-full blur-[50px]"></div>
            </div>

            <div className="relative z-10 flex flex-col items-center justify-center px-8 py-12 w-full max-w-lg">
                {/* Album com glow dinâmico */}
                <div className="relative group">
                    {/* Glow ring atrás do álbum */}
                    <div className={`absolute -inset-4 bg-gradient-to-r from-purple-500 via-lofi-500 to-pink-500 rounded-3xl blur-xl opacity-50 ${playing ? 'animate-pulse-slow' : 'opacity-30'}`}></div>

                    <div className="relative w-72 h-72 rounded-2xl shadow-[0_25px_80px_-20px_rgba(124,58,237,0.6)] overflow-hidden border-2 border-white/20 group">
                        <Image
                            src={currentSong.artworkUrl}
                            alt={`${currentSong.title} by ${currentSong.artist}`}
                            fill
                            className={`object-cover transition-transform duration-700 ${playing ? 'scale-105' : 'scale-100'}`}
                            priority
                            unoptimized
                        />
                        <button
                            onClick={togglePlayPause}
                            className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 group-hover:opacity-100 transition-all duration-300 backdrop-blur-sm"
                            aria-label={props.playing ? "Pause" : "Play"}
                        >
                            {isLoading ? (
                                <div className="w-16 h-16 border-4 border-white border-t-transparent rounded-full animate-spin"></div>
                            ) : playing ? (
                                <PauseIcon className="w-20 h-20 text-white drop-shadow-lg" />
                            ) : (
                                <PlayIcon className="w-20 h-20 text-white drop-shadow-lg" />
                            )}
                        </button>
                    </div>
                </div>

                {/* Track info */}
                <div className="mt-8 w-full">
                    <h2 className="text-3xl font-bold text-white truncate drop-shadow-lg">{currentSong.title}</h2>
                    <p className="text-lg text-white/60 truncate mt-1">{currentSong.artist}</p>
                </div>

                {/* Audio Visualizer - Onda sonora */}
                <div className="w-full mt-8">
                    <AudioVisualizer analyser={analyser} isPlaying={playing} />
                </div>

                {/* Status indicators */}
                <div className="flex items-center justify-center gap-6 text-sm text-white/50 mt-6">
                    <div className="flex items-center gap-2">
                        <div className="relative flex h-2.5 w-2.5">
                            <span className={`absolute inline-flex h-full w-full rounded-full ${playing ? 'bg-green-400 animate-ping' : 'bg-gray-500'} opacity-75`}></span>
                            <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${playing ? 'bg-green-400' : 'bg-gray-500'}`}></span>
                        </div>
                        <span className="font-medium">{playing ? t('live') : t('paused')}</span>
                    </div>
                    <div className="w-px h-4 bg-white/20"></div>
                    <div className="flex items-center gap-1.5">
                        <UsersIcon className="w-4 h-4" />
                        <span>{listenersCount} {t('listeners')}</span>
                    </div>
                </div>

                {/* Volume control */}
                <div className="w-full max-w-xs mx-auto mt-6">
                    <div className="flex items-center gap-3 bg-white/5 rounded-full px-4 py-2 border border-white/10">
                        <SpeakerWaveIcon className="w-5 h-5 text-white/50" />
                        <input
                            type="range"
                            min={0}
                            max={100}
                            value={volume}
                            onChange={handleVolumeChange}
                            className="w-full h-1 accent-lofi-500 bg-white/20 rounded-full appearance-none cursor-pointer"
                            aria-label="Volume"
                        />
                        <span className="text-xs text-white/50 w-8 text-right font-mono">{volume}</span>
                    </div>
                </div>
            </div>
        </div>
    );
};


// Standard Player Layout
const StandardPlayer = (props: any) => {
    const { t, currentSong, playing, isLoading, togglePlayPause, volume, handleVolumeChange, listenersCount, playlistData, activeTab, setActiveTab, historyLoading, dailyHistory, selectedHistoryDate, setSelectedHistoryDate, formatDuration } = props;

    return (
        <div className="relative w-full rounded-2xl overflow-hidden h-full flex flex-col border border-white/10 bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 shadow-2xl shadow-black/40">
            {/* Album section */}
            <div className="relative flex-shrink-0">
                <div className="absolute inset-0 w-full h-full">
                    <Image src={currentSong.artworkUrl} alt={`${currentSong.title} by ${currentSong.artist}`} fill className="object-cover opacity-25 blur-xl scale-110" priority unoptimized />
                    <div className="absolute inset-0 bg-gradient-to-t from-slate-900 via-slate-900/80 to-transparent"></div>
                </div>
                <div className="relative z-10 p-5 text-center text-white">
                    {/* Album art with glow */}
                    <div className="relative inline-block">
                        <div className={`absolute -inset-2 bg-gradient-to-r from-purple-500/40 to-lofi-500/40 rounded-2xl blur-lg ${playing ? 'animate-pulse-slow' : 'opacity-50'}`}></div>
                        <div className="relative w-44 h-44 mx-auto rounded-xl shadow-[0_20px_50px_rgba(124,58,237,0.4)] overflow-hidden border-2 border-white/15 group">
                            <Image src={currentSong.artworkUrl} alt={`${currentSong.title} by ${currentSong.artist}`} fill className="object-cover" priority unoptimized />
                            <button onClick={togglePlayPause} className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 group-hover:opacity-100 transition-all duration-300 backdrop-blur-sm" aria-label={playing ? "Pause" : "Play"}>
                                {isLoading ? <div className="w-12 h-12 border-2 border-white border-t-transparent rounded-full animate-spin"></div> : playing ? <PauseIcon className="w-14 h-14 text-white drop-shadow-lg" /> : <PlayIcon className="w-14 h-14 text-white drop-shadow-lg" />}
                            </button>
                        </div>
                    </div>

                    {/* Track info */}
                    <div className="mt-4">
                        <h2 className="text-lg font-bold text-white truncate">{currentSong.title}</h2>
                        <p className="text-sm text-white/60 truncate mt-0.5">{currentSong.artist}</p>
                    </div>

                    {/* Status */}
                    <div className="flex items-center justify-center gap-4 text-xs text-white/50 mt-3">
                        <div className="flex items-center gap-1.5">
                            <div className="relative flex h-2 w-2">
                                <span className={`absolute inline-flex h-full w-full rounded-full ${playing ? 'bg-green-400 animate-ping' : 'bg-gray-500'} opacity-75`}></span>
                                <span className={`relative inline-flex rounded-full h-2 w-2 ${playing ? 'bg-green-400' : 'bg-gray-500'}`}></span>
                            </div>
                            <span>{playing ? t('live') : t('paused')}</span>
                        </div>
                        <div className="w-px h-3 bg-white/20"></div>
                        <div className="flex items-center gap-1">
                            <UsersIcon className="w-3.5 h-3.5" />
                            <span>{listenersCount}</span>
                        </div>
                    </div>

                    {/* Volume */}
                    <div className="px-2 mt-4">
                        <div className="flex items-center gap-3 bg-white/5 rounded-full px-3 py-1.5 border border-white/10">
                            <SpeakerWaveIcon className="w-4 h-4 text-white/50" />
                            <input type="range" min={0} max={100} value={volume} onChange={handleVolumeChange} className="w-full h-1 accent-lofi-500 bg-white/20 rounded-full appearance-none cursor-pointer" aria-label="Volume" />
                            <span className="text-xs text-white/50 w-6 text-right font-mono">{volume}</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Playlist tabs */}
            <div className="relative z-10 flex border-y border-white/10">
                <button
                    onClick={() => setActiveTab('upcoming')}
                    className={`flex-1 px-4 py-2.5 text-sm font-medium transition-all ${activeTab === 'upcoming' ? 'text-white bg-white/10 border-b-2 border-lofi-500' : 'text-white/50 hover:bg-white/5 hover:text-white/70'}`}
                >
                    {t('tabs.upcoming')} ({playlistData.upcoming.length})
                </button>
                <button
                    onClick={() => setActiveTab('history')}
                    className={`flex-1 px-4 py-2.5 text-sm font-medium transition-all ${activeTab === 'history' ? 'text-white bg-white/10 border-b-2 border-lofi-500' : 'text-white/50 hover:bg-white/5 hover:text-white/70'}`}
                >
                    {t('tabs.history')}
                </button>
            </div>

            {/* Date navigator for history */}
            {activeTab === 'history' && (
                <div className="relative z-10 px-3 pt-3">
                    <DateNavigator selectedDate={selectedHistoryDate} onDateChange={setSelectedHistoryDate} />
                </div>
            )}

            {/* Track list */}
            <div className="relative z-10 flex-1 overflow-y-auto p-3 min-h-0">
                {activeTab === 'upcoming' ? (
                    playlistData.upcoming.length > 0 ? (
                        <div className="space-y-1.5">
                            {playlistData.upcoming.slice(0, 15).map((track: any, index: number) => (
                                <TrackItem key={track.id} number={index + 1} title={track.title} artist={track.artist} duration={formatDuration(track.duration)} />
                            ))}
                        </div>
                    ) : (
                        <EmptyState message={t('emptyQueue')} />
                    )
                ) : historyLoading ? (
                    <div className="text-center py-8">
                        <div className="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-lofi-500"></div>
                    </div>
                ) : dailyHistory.length > 0 ? (
                    <div className="space-y-1.5">
                        {dailyHistory.map((track: any) => (
                            <TrackItem
                                key={`${track.id}-${track.playedAt}`}
                                time={new Date(track.playedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                title={track.title}
                                artist={track.artist}
                                duration={formatDuration(track.duration)}
                            />
                        ))}
                    </div>
                ) : (
                    <EmptyState message={t('emptyHistory')} Icon={CalendarIcon} />
                )}
            </div>
        </div>
    );
}


// Audio Visualizer Component - Onda que vibra na batida
const AudioVisualizer = ({ analyser, isPlaying = false }: { analyser: AnalyserNode | null; isPlaying?: boolean }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const animationRef = useRef<number>(0);
    const analyserRef = useRef<AnalyserNode | null>(analyser);
    const isPlayingRef = useRef(isPlaying);

    // Keep refs updated
    useEffect(() => {
        analyserRef.current = analyser;
    }, [analyser]);

    useEffect(() => {
        isPlayingRef.current = isPlaying;
    }, [isPlaying]);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const context = canvas.getContext('2d');
        if (!context) return;

        // Configurar DPI para canvas nítido
        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        context.scale(dpr, dpr);

        const width = rect.width;
        const height = rect.height;
        const numBars = 48;
        const barGap = 3;
        const barWidth = (width - (numBars - 1) * barGap) / numBars;
        const centerY = height / 2;

        // Array para suavização
        let smoothedData = new Array(numBars).fill(0);

        const draw = () => {
            animationRef.current = requestAnimationFrame(draw);

            // Limpar canvas
            context.clearRect(0, 0, width, height);

            // Desenhar linha central sutil
            context.beginPath();
            context.strokeStyle = 'rgba(255, 255, 255, 0.1)';
            context.lineWidth = 1;
            context.moveTo(0, centerY);
            context.lineTo(width, centerY);
            context.stroke();

            // Use refs to get current values
            const currentAnalyser = analyserRef.current;
            const currentIsPlaying = isPlayingRef.current;

            if (currentAnalyser && currentIsPlaying) {
                const bufferLength = currentAnalyser.frequencyBinCount;
                const dataArray = new Uint8Array(bufferLength);
                currentAnalyser.getByteFrequencyData(dataArray);

                // Mapear frequências para barras com suavização
                for (let i = 0; i < numBars; i++) {
                    const dataIndex = Math.floor((i / numBars) * bufferLength * 0.7);
                    const value = dataArray[dataIndex] / 255;
                    // Suavização exponencial
                    smoothedData[i] = smoothedData[i] * 0.7 + value * 0.3;
                }
            } else {
                // Quando pausado, animação idle sutil
                const time = Date.now() / 1000;
                for (let i = 0; i < numBars; i++) {
                    const wave = Math.sin(time * 2 + i * 0.3) * 0.05 + 0.08;
                    smoothedData[i] = smoothedData[i] * 0.95 + wave * 0.05;
                }
            }

            // Desenhar barras espelhadas (wave effect)
            for (let i = 0; i < numBars; i++) {
                const x = i * (barWidth + barGap);
                const barHeight = smoothedData[i] * (height * 0.8);

                // Gradiente para cada barra
                const gradient = context.createLinearGradient(x, centerY - barHeight / 2, x, centerY + barHeight / 2);
                gradient.addColorStop(0, 'rgba(168, 85, 247, 0.9)'); // purple-500
                gradient.addColorStop(0.5, 'rgba(156, 111, 196, 1)'); // lofi-500
                gradient.addColorStop(1, 'rgba(236, 72, 153, 0.8)'); // pink-500

                // Barra com cantos arredondados
                context.fillStyle = gradient;
                context.beginPath();

                const radius = barWidth / 2;
                const topY = centerY - barHeight / 2;
                const bottomY = centerY + barHeight / 2;

                // Desenhar retângulo com cantos arredondados
                context.moveTo(x + radius, topY);
                context.lineTo(x + barWidth - radius, topY);
                context.arcTo(x + barWidth, topY, x + barWidth, topY + radius, radius);
                context.lineTo(x + barWidth, bottomY - radius);
                context.arcTo(x + barWidth, bottomY, x + barWidth - radius, bottomY, radius);
                context.lineTo(x + radius, bottomY);
                context.arcTo(x, bottomY, x, bottomY - radius, radius);
                context.lineTo(x, topY + radius);
                context.arcTo(x, topY, x + radius, topY, radius);
                context.closePath();
                context.fill();

                // Glow effect sutil
                context.shadowBlur = 10;
                context.shadowColor = 'rgba(168, 85, 247, 0.3)';
            }

            context.shadowBlur = 0;
        };

        draw();

        return () => {
            cancelAnimationFrame(animationRef.current);
        };
    }, [analyser, isPlaying]);

    return (
        <div className="relative w-full">
            <canvas
                ref={canvasRef}
                className="w-full h-24"
                style={{ width: '100%', height: '96px' }}
            />
        </div>
    );
};


// Helper Components
const TrackItem = ({ number, time, title, artist, duration }: { number?: number; time?: string; title: string; artist: string; duration: string; }) => (
    <div className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-white/10 transition-all duration-200 border border-transparent hover:border-white/10 cursor-pointer group">
        {number && (
            <span className="text-xs text-white/40 w-5 text-center font-mono group-hover:text-white/60 transition-colors">
                {number}
            </span>
        )}
        {time && (
            <div className="flex items-center gap-1 text-xs text-white/50 w-12">
                <ClockIcon className="w-3 h-3" />
                <span>{time}</span>
            </div>
        )}
        <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-white/90 truncate group-hover:text-white transition-colors">{title}</p>
            <p className="text-xs text-white/50 truncate mt-0.5">{artist}</p>
        </div>
        <span className="text-xs text-white/40 font-mono">{duration}</span>
    </div>
);

const EmptyState = ({ message, Icon }: { message: string, Icon?: React.ComponentType<{ className: string }> }) => (
    <div className="flex flex-col items-center justify-center h-full text-center text-white/40 py-8">
        {Icon ? (
            <Icon className="w-10 h-10 mb-3 text-white/30" />
        ) : (
            <MusicalNoteIcon className="w-10 h-10 mb-3 text-white/30" />
        )}
        <p className="text-sm">{message}</p>
    </div>
);
