'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import Image from 'next/image';
import { useChat as useSocketChat, useSocket, usePlaybackSync, useListeners } from '../lib/socket/client';
import { useUserPreferences } from '../hooks/useUserPreferences';
import {
    PlayIcon,
    PauseIcon,
    SpeakerWaveIcon,
    UsersIcon,
    ChatBubbleLeftRightIcon,
    XMarkIcon,
} from '@heroicons/react/24/solid';

interface ZenModeProps {
    onExit: () => void;
    analyser: AnalyserNode | null;
    playing: boolean;
    isLoading: boolean;
    togglePlayPause: () => void;
}

// Floating message component
const FloatingMessage = ({
    message,
    index,
    onAnimationEnd,
}: {
    message: { id: string; content: string; username: string; isAI: boolean };
    index: number;
    onAnimationEnd: (id: string) => void;
}) => {
    const startY = 20 + (index % 5) * 15; // Stagger vertically

    return (
        <div
            className="floating-message absolute right-8 pointer-events-none"
            style={{
                top: `${startY}%`,
                animationDelay: `${index * 0.3}s`,
            }}
            onAnimationEnd={() => onAnimationEnd(message.id)}
        >
            <div className="flex items-start gap-2 bg-black/40 backdrop-blur-md rounded-2xl px-4 py-3 border border-white/10 shadow-xl max-w-xs">
                <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${
                    message.isAI
                        ? 'bg-gradient-to-br from-[var(--mood-accent)] to-[var(--mood-accent-2)]'
                        : 'bg-white/20'
                }`}>
                    <span className="text-xs text-white">
                        {message.isAI ? '🎧' : message.username.charAt(0).toUpperCase()}
                    </span>
                </div>
                <div className="min-w-0">
                    <p className="text-xs text-white/60 font-medium truncate">{message.username}</p>
                    <p className="text-sm text-white/90 line-clamp-2">{message.content}</p>
                </div>
            </div>
        </div>
    );
};

// Command hint component
const CommandHint = ({ shortcut, label, active = false }: { shortcut: string; label: string; active?: boolean }) => (
    <div className={`flex items-center gap-2 transition-all duration-300 ${active ? 'opacity-100' : 'opacity-60 hover:opacity-100'}`}>
        <kbd className={`px-2 py-1 text-xs font-mono rounded-md border transition-all duration-300 ${
            active
                ? 'bg-white/20 border-white/40 text-white'
                : 'bg-white/5 border-white/15 text-white/70'
        }`}>
            {shortcut}
        </kbd>
        <span className="text-xs text-white/60">{label}</span>
    </div>
);

// Aurora wave background component
const AuroraBackground = () => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const animationRef = useRef<number>(0);
    const paletteRef = useRef({ accent: '#5fa3a9', accent2: '#8f6ea9', accent3: '#d9b8a6' });

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const readPalette = () => {
            const styles = getComputedStyle(document.documentElement);
            paletteRef.current = {
                accent: styles.getPropertyValue('--mood-accent').trim() || '#5fa3a9',
                accent2: styles.getPropertyValue('--mood-accent-2').trim() || '#8f6ea9',
                accent3: styles.getPropertyValue('--mood-accent-3').trim() || '#d9b8a6',
            };
        };

        readPalette();

        let width = window.innerWidth;
        let height = window.innerHeight;

        const resize = () => {
            width = window.innerWidth;
            height = window.innerHeight;
            const dpr = window.devicePixelRatio || 1;
            canvas.width = width * dpr;
            canvas.height = height * dpr;
            ctx.scale(dpr, dpr);
        };

        resize();
        window.addEventListener('resize', resize);

        const hexToRgb = (hex: string) => {
            const cleaned = hex.replace('#', '').trim();
            if (cleaned.length !== 6) return { r: 95, g: 163, b: 169 };
            return {
                r: parseInt(cleaned.slice(0, 2), 16),
                g: parseInt(cleaned.slice(2, 4), 16),
                b: parseInt(cleaned.slice(4, 6), 16),
            };
        };

        let time = 0;

        const draw = () => {
            animationRef.current = requestAnimationFrame(draw);
            time += 0.003;

            // Dark gradient base
            const baseGradient = ctx.createLinearGradient(0, 0, 0, height);
            baseGradient.addColorStop(0, 'rgb(8, 10, 18)');
            baseGradient.addColorStop(0.5, 'rgb(12, 14, 24)');
            baseGradient.addColorStop(1, 'rgb(6, 8, 14)');
            ctx.fillStyle = baseGradient;
            ctx.fillRect(0, 0, width, height);

            const { accent, accent2, accent3 } = paletteRef.current;
            const rgb1 = hexToRgb(accent);
            const rgb2 = hexToRgb(accent2);
            const rgb3 = hexToRgb(accent3);

            // Aurora waves - multiple layers with different speeds and frequencies
            const waveConfigs = [
                { color: rgb1, amplitude: 80, frequency: 0.002, speed: 0.5, yOffset: 0.65, opacity: 0.15, blur: 100 },
                { color: rgb2, amplitude: 100, frequency: 0.0015, speed: 0.7, yOffset: 0.55, opacity: 0.12, blur: 120 },
                { color: rgb3, amplitude: 60, frequency: 0.0025, speed: 0.4, yOffset: 0.75, opacity: 0.1, blur: 80 },
                { color: rgb1, amplitude: 120, frequency: 0.001, speed: 0.3, yOffset: 0.45, opacity: 0.08, blur: 150 },
                { color: rgb2, amplitude: 70, frequency: 0.003, speed: 0.6, yOffset: 0.7, opacity: 0.12, blur: 90 },
            ];

            // Draw aurora waves
            waveConfigs.forEach((config, layerIndex) => {
                ctx.save();
                ctx.filter = `blur(${config.blur}px)`;

                const gradient = ctx.createLinearGradient(0, height * 0.3, 0, height);
                gradient.addColorStop(0, `rgba(${config.color.r}, ${config.color.g}, ${config.color.b}, 0)`);
                gradient.addColorStop(0.3, `rgba(${config.color.r}, ${config.color.g}, ${config.color.b}, ${config.opacity})`);
                gradient.addColorStop(0.7, `rgba(${config.color.r}, ${config.color.g}, ${config.color.b}, ${config.opacity * 0.5})`);
                gradient.addColorStop(1, `rgba(${config.color.r}, ${config.color.g}, ${config.color.b}, 0)`);

                ctx.fillStyle = gradient;
                ctx.beginPath();
                ctx.moveTo(0, height);

                for (let x = 0; x <= width; x += 4) {
                    const wave1 = Math.sin(x * config.frequency + time * config.speed) * config.amplitude;
                    const wave2 = Math.sin(x * config.frequency * 1.5 + time * config.speed * 0.8 + layerIndex) * config.amplitude * 0.5;
                    const wave3 = Math.sin(x * config.frequency * 0.5 + time * config.speed * 1.2) * config.amplitude * 0.3;
                    const y = height * config.yOffset + wave1 + wave2 + wave3;
                    ctx.lineTo(x, y);
                }

                ctx.lineTo(width, height);
                ctx.closePath();
                ctx.fill();
                ctx.restore();
            });

            // Add subtle floating particles
            const particleCount = 25;
            for (let i = 0; i < particleCount; i++) {
                const x = (Math.sin(time * 0.1 + i * 0.5) + 1) * 0.5 * width;
                const y = (Math.cos(time * 0.08 + i * 0.7) + 1) * 0.5 * height;
                const size = 1 + Math.sin(time + i) * 0.5;
                const alpha = 0.1 + Math.sin(time * 0.5 + i) * 0.05;

                ctx.beginPath();
                ctx.arc(x, y, size, 0, Math.PI * 2);
                ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
                ctx.fill();
            }

            // Subtle vignette
            const vignette = ctx.createRadialGradient(
                width / 2, height / 2, 0,
                width / 2, height / 2, Math.max(width, height) * 0.8
            );
            vignette.addColorStop(0, 'rgba(0, 0, 0, 0)');
            vignette.addColorStop(0.7, 'rgba(0, 0, 0, 0)');
            vignette.addColorStop(1, 'rgba(0, 0, 0, 0.4)');
            ctx.fillStyle = vignette;
            ctx.fillRect(0, 0, width, height);
        };

        draw();

        const handleMoodChange = () => readPalette();
        window.addEventListener('moodchange', handleMoodChange);

        return () => {
            window.removeEventListener('resize', resize);
            window.removeEventListener('moodchange', handleMoodChange);
            cancelAnimationFrame(animationRef.current);
        };
    }, []);

    return (
        <canvas
            ref={canvasRef}
            className="absolute inset-0 w-full h-full"
            style={{ width: '100%', height: '100%' }}
        />
    );
};

// Audio visualizer for zen mode (compact wave)
const ZenVisualizer = ({ analyser, isPlaying }: { analyser: AnalyserNode | null; isPlaying: boolean }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const animationRef = useRef<number>(0);
    const analyserRef = useRef<AnalyserNode | null>(analyser);
    const isPlayingRef = useRef(isPlaying);
    const paletteRef = useRef({ accent: '#5fa3a9', accent2: '#8f6ea9' });

    useEffect(() => {
        analyserRef.current = analyser;
    }, [analyser]);

    useEffect(() => {
        isPlayingRef.current = isPlaying;
    }, [isPlaying]);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const readPalette = () => {
            const styles = getComputedStyle(document.documentElement);
            paletteRef.current = {
                accent: styles.getPropertyValue('--mood-accent').trim() || '#5fa3a9',
                accent2: styles.getPropertyValue('--mood-accent-2').trim() || '#8f6ea9',
            };
        };

        readPalette();

        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        ctx.scale(dpr, dpr);

        const width = rect.width;
        const height = rect.height;
        const numBars = 64;
        const barGap = 2;
        const barWidth = (width - (numBars - 1) * barGap) / numBars;
        const centerY = height / 2;

        const smoothedData = new Array(numBars).fill(0);

        const hexToRgba = (hex: string, alpha: number) => {
            const cleaned = hex.replace('#', '').trim();
            if (cleaned.length !== 6) return `rgba(95, 163, 169, ${alpha})`;
            const r = parseInt(cleaned.slice(0, 2), 16);
            const g = parseInt(cleaned.slice(2, 4), 16);
            const b = parseInt(cleaned.slice(4, 6), 16);
            return `rgba(${r}, ${g}, ${b}, ${alpha})`;
        };

        const draw = () => {
            animationRef.current = requestAnimationFrame(draw);

            ctx.clearRect(0, 0, width, height);

            const currentAnalyser = analyserRef.current;
            const currentIsPlaying = isPlayingRef.current;

            if (currentAnalyser && currentIsPlaying) {
                const bufferLength = currentAnalyser.frequencyBinCount;
                const dataArray = new Uint8Array(bufferLength);
                currentAnalyser.getByteFrequencyData(dataArray);

                for (let i = 0; i < numBars; i++) {
                    const dataIndex = Math.floor((i / numBars) * bufferLength * 0.75);
                    const value = dataArray[dataIndex] / 255;
                    smoothedData[i] = smoothedData[i] * 0.75 + value * 0.25;
                }
            } else {
                const time = Date.now() / 1000;
                for (let i = 0; i < numBars; i++) {
                    const wave = Math.sin(time * 1.5 + i * 0.2) * 0.03 + 0.05;
                    smoothedData[i] = smoothedData[i] * 0.96 + wave * 0.04;
                }
            }

            // Draw circular wave visualization
            for (let i = 0; i < numBars; i++) {
                const x = i * (barWidth + barGap);
                const barHeight = Math.max(2, smoothedData[i] * (height * 0.9));

                const gradient = ctx.createLinearGradient(x, centerY - barHeight / 2, x, centerY + barHeight / 2);
                gradient.addColorStop(0, hexToRgba(paletteRef.current.accent, 0.9));
                gradient.addColorStop(0.5, hexToRgba(paletteRef.current.accent2, 0.95));
                gradient.addColorStop(1, hexToRgba(paletteRef.current.accent, 0.9));

                ctx.fillStyle = gradient;

                const radius = barWidth / 2;
                const topY = centerY - barHeight / 2;
                const bottomY = centerY + barHeight / 2;

                ctx.beginPath();
                ctx.moveTo(x + radius, topY);
                ctx.lineTo(x + barWidth - radius, topY);
                ctx.arcTo(x + barWidth, topY, x + barWidth, topY + radius, radius);
                ctx.lineTo(x + barWidth, bottomY - radius);
                ctx.arcTo(x + barWidth, bottomY, x + barWidth - radius, bottomY, radius);
                ctx.lineTo(x + radius, bottomY);
                ctx.arcTo(x, bottomY, x, bottomY - radius, radius);
                ctx.lineTo(x, topY + radius);
                ctx.arcTo(x, topY, x + radius, topY, radius);
                ctx.closePath();
                ctx.fill();

                // Glow
                ctx.shadowBlur = 8;
                ctx.shadowColor = hexToRgba(paletteRef.current.accent, 0.3);
            }

            ctx.shadowBlur = 0;
        };

        draw();

        const handleMoodChange = () => readPalette();
        window.addEventListener('moodchange', handleMoodChange);

        return () => {
            window.removeEventListener('moodchange', handleMoodChange);
            cancelAnimationFrame(animationRef.current);
        };
    }, []);

    return (
        <canvas
            ref={canvasRef}
            className="w-full"
            style={{ width: '100%', height: '64px' }}
        />
    );
};

export default function ZenMode({
    onExit,
    analyser,
    playing,
    isLoading,
    togglePlayPause,
}: ZenModeProps) {
    const playerT = useTranslations('player');
    const chatT = useTranslations('chat');

    const [showChat, setShowChat] = useState(false);
    const [showInput, setShowInput] = useState(false);
    const [inputValue, setInputValue] = useState('');
    const [visibleMessages, setVisibleMessages] = useState<Array<{ id: string; content: string; username: string; isAI: boolean }>>([]);
    const [showHints, setShowHints] = useState(true);

    const inputRef = useRef<HTMLInputElement>(null);
    const processedMessagesRef = useRef<Set<string>>(new Set());

    const { messages } = useSocketChat();
    const { sendChatMessage, isConnected } = useSocket();
    const { currentTrack } = usePlaybackSync();
    const { listenersCount } = useListeners();
    const { preferences, setVolume: saveVolume } = useUserPreferences();
    const volume = preferences.volume;

    // Handle new messages for floating display
    useEffect(() => {
        if (!showChat || messages.length === 0) return;

        const lastMessage = messages[messages.length - 1];

        // Check if we already processed this message
        if (processedMessagesRef.current.has(lastMessage.id)) return;
        processedMessagesRef.current.add(lastMessage.id);

        const isAI = lastMessage.type === 'ai' || lastMessage.type === 'system' || lastMessage.userId === 'dj';

        setVisibleMessages(prev => {
            const newMessages = [...prev, {
                id: lastMessage.id,
                content: lastMessage.content.slice(0, 100) + (lastMessage.content.length > 100 ? '...' : ''),
                username: lastMessage.username || 'User',
                isAI,
            }];
            // Keep only last 5 messages
            return newMessages.slice(-5);
        });
    }, [messages, showChat]);

    const handleMessageAnimationEnd = useCallback((id: string) => {
        setVisibleMessages(prev => prev.filter(m => m.id !== id));
    }, []);

    const handleSendMessage = useCallback(() => {
        if (inputValue.trim() && sendChatMessage && isConnected) {
            sendChatMessage(inputValue, { isPrivate: false, locale: 'pt' });
            setInputValue('');
            setShowInput(false);
        }
    }, [inputValue, sendChatMessage, isConnected]);

    // Keyboard shortcuts
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // Don't handle shortcuts when typing
            if (showInput && inputRef.current === document.activeElement) {
                if (e.key === 'Escape') {
                    setShowInput(false);
                    setInputValue('');
                } else if (e.key === 'Enter' && inputValue.trim()) {
                    handleSendMessage();
                }
                return;
            }

            switch (e.key.toLowerCase()) {
                case 'escape':
                    onExit();
                    break;
                case 'c':
                    setShowChat(prev => !prev);
                    break;
                case 'r':
                    if (showChat) {
                        setShowInput(true);
                        setTimeout(() => inputRef.current?.focus(), 50);
                    }
                    break;
                case ' ':
                    e.preventDefault();
                    togglePlayPause();
                    break;
                case 'h':
                    setShowHints(prev => !prev);
                    break;
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [showInput, inputValue, showChat, onExit, togglePlayPause, handleSendMessage]);

    const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const newVolume = Number(e.target.value);
        saveVolume(newVolume);
    };

    const currentSong = currentTrack;

    return (
        <div className="fixed inset-0 z-50 overflow-hidden">
            {/* Aurora background */}
            <AuroraBackground />

            {/* Exit button */}
            <button
                type="button"
                onClick={onExit}
                className="absolute top-6 right-6 z-50 p-3 rounded-full border transition-all duration-300 bg-black/30 text-white/80 border-white/20 hover:bg-black/50 hover:text-white backdrop-blur-md group"
                aria-label={playerT('zenMode.exit')}
            >
                <XMarkIcon className="w-5 h-5 transition-transform group-hover:scale-110" />
            </button>

            {/* Chat toggle button */}
            <button
                type="button"
                onClick={() => setShowChat(prev => !prev)}
                className={`absolute top-6 left-6 z-50 p-3 rounded-full border transition-all duration-300 backdrop-blur-md ${
                    showChat
                        ? 'bg-white/20 text-white border-white/40'
                        : 'bg-black/30 text-white/80 border-white/20 hover:bg-black/50 hover:text-white'
                }`}
                aria-label={showChat ? 'Hide chat' : 'Show chat'}
            >
                <ChatBubbleLeftRightIcon className="w-5 h-5" />
            </button>

            {/* Floating chat messages */}
            {showChat && (
                <div className="absolute inset-y-0 right-0 w-96 pointer-events-none z-30">
                    {visibleMessages.map((msg, index) => (
                        <FloatingMessage
                            key={msg.id}
                            message={msg}
                            index={index}
                            onAnimationEnd={handleMessageAnimationEnd}
                        />
                    ))}
                </div>
            )}

            {/* Chat input overlay */}
            {showInput && (
                <div className="absolute bottom-32 left-1/2 -translate-x-1/2 z-50 w-full max-w-lg px-6">
                    <div className="bg-black/60 backdrop-blur-xl rounded-2xl border border-white/20 p-4 shadow-2xl">
                        <div className="flex items-center gap-3">
                            <input
                                ref={inputRef}
                                type="text"
                                value={inputValue}
                                onChange={(e) => setInputValue(e.target.value)}
                                placeholder={chatT('input.placeholder')}
                                className="flex-1 bg-white/10 border border-white/20 rounded-full px-4 py-2.5 text-white text-sm focus:outline-none focus:border-white/40 placeholder-white/40"
                            />
                            <button
                                onClick={handleSendMessage}
                                disabled={!inputValue.trim()}
                                className="px-4 py-2.5 bg-gradient-to-r from-[var(--mood-accent)] to-[var(--mood-accent-2)] text-white rounded-full font-medium text-sm disabled:opacity-50 transition-all hover:brightness-110"
                            >
                                Enviar
                            </button>
                        </div>
                        <p className="text-xs text-white/40 mt-2 text-center">
                            Pressione <kbd className="px-1.5 py-0.5 bg-white/10 rounded text-white/60">Enter</kbd> para enviar ou <kbd className="px-1.5 py-0.5 bg-white/10 rounded text-white/60">Esc</kbd> para cancelar
                        </p>
                    </div>
                </div>
            )}

            {/* Main content */}
            <div className="relative z-20 w-full h-full flex flex-col items-center justify-center px-8">
                {currentSong ? (
                    <>
                        {/* Album art with glow */}
                        <div className="relative group mb-8">
                            {/* Dynamic glow */}
                            <div className={`absolute -inset-8 rounded-3xl blur-3xl transition-opacity duration-700 ${playing ? 'opacity-60' : 'opacity-30'}`}
                                style={{
                                    background: 'linear-gradient(135deg, rgb(var(--mood-accent-rgb) / 0.5), rgb(var(--mood-accent-2-rgb) / 0.5), rgb(var(--mood-accent-3-rgb) / 0.3))',
                                }}
                            />

                            {/* Spinning ring when playing */}
                            <div className={`absolute -inset-4 rounded-3xl border-2 border-dashed transition-all duration-500 ${
                                playing ? 'border-white/20 animate-spin-slow' : 'border-transparent'
                            }`} style={{ animationDuration: '20s' }} />

                            <div className="relative w-80 h-80 rounded-2xl shadow-2xl overflow-hidden border-2 border-white/20 group">
                                <Image
                                    src={currentSong.artworkUrl || '/placeholder-album.png'}
                                    alt={`${currentSong.title} by ${currentSong.artist}`}
                                    fill
                                    className={`object-cover transition-transform duration-700 ${playing ? 'scale-105' : 'scale-100'}`}
                                    priority
                                    unoptimized
                                />

                                {/* Play/pause overlay */}
                                <button
                                    onClick={togglePlayPause}
                                    className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-all duration-300 backdrop-blur-sm"
                                    aria-label={playing ? 'Pause' : 'Play'}
                                >
                                    {isLoading ? (
                                        <div className="w-16 h-16 border-4 border-white border-t-transparent rounded-full animate-spin" />
                                    ) : playing ? (
                                        <PauseIcon className="w-20 h-20 text-white drop-shadow-lg" />
                                    ) : (
                                        <PlayIcon className="w-20 h-20 text-white drop-shadow-lg" />
                                    )}
                                </button>
                            </div>
                        </div>

                        {/* Track info */}
                        <div className="text-center mb-6">
                            <h2 className="text-4xl font-bold text-white drop-shadow-lg mb-2 truncate max-w-2xl">
                                {currentSong.title}
                            </h2>
                            <p className="text-xl text-white/70">{currentSong.artist}</p>
                        </div>

                        {/* Visualizer */}
                        <div className="w-full max-w-2xl mb-8">
                            <ZenVisualizer analyser={analyser} isPlaying={playing} />
                        </div>

                        {/* Status and controls */}
                        <div className="flex flex-col items-center gap-6 w-full max-w-lg">
                            {/* Status indicators */}
                            <div className="flex items-center gap-6 text-sm text-white/60">
                                <div className="flex items-center gap-2">
                                    <div className="relative flex h-2.5 w-2.5">
                                        <span className={`absolute inline-flex h-full w-full rounded-full ${playing ? 'bg-emerald-400 animate-ping' : 'bg-gray-500'} opacity-75`} />
                                        <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${playing ? 'bg-emerald-400' : 'bg-gray-500'}`} />
                                    </div>
                                    <span className="font-medium">{playing ? playerT('live') : playerT('paused')}</span>
                                </div>
                                <div className="w-px h-4 bg-white/20" />
                                <div className="flex items-center gap-1.5">
                                    <UsersIcon className="w-4 h-4" />
                                    <span>{listenersCount} {playerT('listeners')}</span>
                                </div>
                            </div>

                            {/* Volume control */}
                            <div className="w-full max-w-xs">
                                <div className="flex items-center gap-3 bg-black/30 backdrop-blur-md rounded-full px-4 py-2.5 border border-white/10">
                                    <SpeakerWaveIcon className="w-5 h-5 text-white/60" />
                                    <input
                                        type="range"
                                        min={0}
                                        max={100}
                                        value={volume}
                                        onChange={handleVolumeChange}
                                        className="w-full h-1.5 accent-lofi-500 bg-white/20 rounded-full appearance-none cursor-pointer"
                                        aria-label="Volume"
                                    />
                                    <span className="text-xs text-white/60 w-8 text-right font-mono">{volume}</span>
                                </div>
                            </div>
                        </div>
                    </>
                ) : (
                    <div className="text-center">
                        <div className="w-16 h-16 border-4 border-white/20 border-t-white/80 rounded-full animate-spin mb-4" />
                        <p className="text-white/60">Carregando...</p>
                    </div>
                )}
            </div>

            {/* Command hints */}
            {showHints && (
                <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-40">
                    <div className="flex items-center gap-4 bg-black/40 backdrop-blur-md rounded-full px-5 py-2.5 border border-white/10">
                        <CommandHint shortcut="Esc" label="Sair" />
                        <CommandHint shortcut="C" label="Chat" active={showChat} />
                        {showChat && <CommandHint shortcut="R" label="Responder" />}
                        <CommandHint shortcut="Espaço" label="Play/Pause" />
                        <CommandHint shortcut="H" label="Ocultar dicas" />
                    </div>
                </div>
            )}

            {/* Styles */}
            <style jsx>{`
                @keyframes spin-slow {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }
                .animate-spin-slow {
                    animation: spin-slow 20s linear infinite;
                }
                .floating-message {
                    animation: floatIn 8s ease-in-out forwards;
                }
                @keyframes floatIn {
                    0% {
                        opacity: 0;
                        transform: translateX(100px) translateY(0);
                    }
                    10% {
                        opacity: 1;
                        transform: translateX(0) translateY(0);
                    }
                    80% {
                        opacity: 1;
                        transform: translateX(0) translateY(-20px);
                    }
                    100% {
                        opacity: 0;
                        transform: translateX(-50px) translateY(-40px);
                    }
                }
            `}</style>
        </div>
    );
}
