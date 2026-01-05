'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState, useEffect, useRef, useCallback } from 'react';
import RadioPlayer from './RadioPlayer';
import ChatRoom from './ChatRoom';
import ZenMode from './ZenMode';
import { useUserPreferences } from '../hooks/useUserPreferences';

export function LocalizedComponents() {
    const locale = useLocale();
    const t = useTranslations('player');
    const [zenMode, setZenMode] = useState(false);
    const [playing, setPlaying] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const zenContainerRef = useRef<HTMLDivElement>(null);

    const audioRef = useRef<HTMLAudioElement | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
    const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);

    const { preferences, isLoaded } = useUserPreferences();
    const volume = preferences.volume;

    // Setup audio element
    useEffect(() => {
        if (audioRef.current || !isLoaded) return;

        const audio = new Audio();
        audioRef.current = audio;
        audio.crossOrigin = 'anonymous';
        audio.volume = volume / 100;
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

        audio.play().catch(e => console.warn('Autoplay blocked', e));

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
    }, [isLoaded]);

    // Update volume when preferences change
    useEffect(() => {
        if (audioRef.current) {
            audioRef.current.volume = volume / 100;
        }
    }, [volume]);

    const initAudioContext = useCallback(() => {
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
            console.error('Failed to initialize AudioContext:', error);
        }
    }, []);

    const togglePlayPause = useCallback(() => {
        if (!audioRef.current) return;
        if (playing) {
            audioRef.current.pause();
        } else {
            setIsLoading(true);
            audioRef.current.src = '/api/stream/audio-stream?proxy=true&t=' + Date.now();
            audioRef.current.load();
            initAudioContext();
            audioRef.current.play().catch(e => {
                console.error('Play error:', e);
                setIsLoading(false);
            });
        }
    }, [playing, initAudioContext]);

    // Handle fullscreen changes - exit zen mode when user exits fullscreen
    useEffect(() => {
        const handleFullscreenChange = () => {
            if (!document.fullscreenElement && zenMode) {
                setZenMode(false);
            }
        };

        document.addEventListener('fullscreenchange', handleFullscreenChange);
        return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
    }, [zenMode]);

    // Toggle zen mode with fullscreen
    const toggleZenMode = useCallback(async () => {
        if (!zenMode) {
            // Entering zen mode - go fullscreen
            setZenMode(true);
            try {
                if (zenContainerRef.current && document.fullscreenEnabled) {
                    await zenContainerRef.current.requestFullscreen();
                }
            } catch (err) {
                console.warn('Fullscreen not available:', err);
            }
        } else {
            // Exiting zen mode
            setZenMode(false);
            if (document.fullscreenElement) {
                await document.exitFullscreen();
            }
        }
    }, [zenMode]);

    const exitZenMode = useCallback(async () => {
        setZenMode(false);
        if (document.fullscreenElement) {
            await document.exitFullscreen();
        }
    }, []);

    return (
        <div className="w-full space-y-6" ref={zenContainerRef}>
            {/* Zen Mode Toggle */}
            {!zenMode && (
                <div className="flex items-center justify-end">
                    <button
                        type="button"
                        onClick={toggleZenMode}
                        className="group relative px-5 py-2.5 text-sm font-medium rounded-full border transition-all duration-300 flex items-center gap-2 bg-white/5 text-white/80 border-white/15 hover:bg-white/10 hover:border-white/25 hover:text-white"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                        </svg>
                        {t('zenMode.activate')}
                    </button>
                </div>
            )}

            {/* Zen Mode Fullscreen Layout */}
            {zenMode && (
                <ZenMode
                    onExit={exitZenMode}
                    analyser={analyser}
                    playing={playing}
                    isLoading={isLoading}
                    togglePlayPause={togglePlayPause}
                />
            )}

            {/* Main Content Grid (Normal Mode) */}
            {!zenMode && (
                <div className="w-full grid grid-cols-1 lg:grid-cols-12 gap-6">
                    <div className="lg:col-span-5 min-h-[520px] h-[70vh] max-h-[720px]">
                        <RadioPlayer key={`player-${locale}`} zen={false} />
                    </div>
                    <div className="lg:col-span-7 min-h-[520px] h-[70vh] max-h-[720px]">
                        <ChatRoom key={`chat-${locale}`} />
                    </div>
                </div>
            )}
        </div>
    );
}
