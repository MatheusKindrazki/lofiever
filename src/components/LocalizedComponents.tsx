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
    const tChat = useTranslations('chat');
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
            setZenMode(true);
            try {
                if (zenContainerRef.current && document.fullscreenEnabled) {
                    await zenContainerRef.current.requestFullscreen();
                }
            } catch (err) {
                console.warn('Fullscreen not available:', err);
            }
        } else {
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
        <div className="w-full" ref={zenContainerRef}>
            {zenMode && (
                <ZenMode
                    onExit={exitZenMode}
                    analyser={analyser}
                    playing={playing}
                    isLoading={isLoading}
                    togglePlayPause={togglePlayPause}
                />
            )}

            {!zenMode && (
                <div className="mx-auto w-full max-w-6xl">
                    <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 lg:gap-x-8 lg:gap-y-0">
                        <div className="relative lg:col-span-7 lg:col-start-1">
                            <div
                                aria-hidden="true"
                                className="pointer-events-none absolute -inset-x-6 -inset-y-4 rounded-[2rem] bg-[radial-gradient(ellipse_at_center,color-mix(in_srgb,var(--mood-accent-2)_14%,transparent)_0%,transparent_72%)] opacity-80"
                            />

                            <div className="relative flex items-start justify-between gap-4 pb-3">
                                <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-lofi-400">
                                    {t('nowPlaying')}
                                </p>
                                <button
                                    type="button"
                                    onClick={toggleZenMode}
                                    className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs text-lofi-300 transition-colors hover:bg-lofi-900/50 hover:text-lofi-100"
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                                    </svg>
                                    {t('zenMode.activate')}
                                </button>
                            </div>

                            <div className="relative min-h-[480px] h-[min(72vh,680px)]">
                                <RadioPlayer key={`player-${locale}`} zen={false} />
                            </div>
                        </div>

                        <div className="flex min-h-[420px] flex-col lg:col-span-5 lg:col-start-8 lg:pt-14 lg:pb-2">
                            <p className="mb-3 font-mono text-[11px] uppercase tracking-[0.16em] text-lofi-400">
                                {tChat('djName')}
                            </p>
                            <div className="min-h-[420px] flex-1 h-[min(62vh,560px)] lg:h-[min(58vh,520px)]">
                                <ChatRoom key={`chat-${locale}`} />
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
