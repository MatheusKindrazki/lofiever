'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState, useEffect, useRef, useCallback } from 'react';
import RadioPlayer from './RadioPlayer';
import ChatRoom from './ChatRoom';
import AnimatedBackground from './AnimatedBackground';

export function LocalizedComponents() {
    const locale = useLocale();
    const t = useTranslations('player');
    const [zenMode, setZenMode] = useState(false);
    const zenContainerRef = useRef<HTMLDivElement>(null);

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

    // Handle ESC key to exit zen mode
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && zenMode && !document.fullscreenElement) {
                setZenMode(false);
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [zenMode]);

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
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950 overflow-hidden">
                    {/* Animated background - inside zen container */}
                    <div className="absolute inset-0 z-0">
                        <AnimatedBackground />
                    </div>

                    {/* Exit button */}
                    <button
                        type="button"
                        onClick={toggleZenMode}
                        className="absolute top-6 right-6 z-50 px-4 py-2 text-sm font-medium rounded-full border transition-all duration-300 flex items-center gap-2 bg-white/10 text-white/80 border-white/20 hover:bg-white/20 hover:text-white backdrop-blur-sm"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                        {t('zenMode.exit')}
                    </button>

                    {/* Centered Player */}
                    <div className="relative z-10 w-full max-w-2xl px-8">
                        <RadioPlayer key={`player-zen-${locale}`} zen={true} />
                    </div>
                </div>
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
