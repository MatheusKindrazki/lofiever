'use client';

import { useEffect, useRef } from 'react';

interface AnimatedBackgroundProps {
    className?: string;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const toRgba = (hex: string, alpha: number) => {
    const cleaned = hex.replace('#', '').trim();
    if (cleaned.length !== 6) return `rgba(95, 163, 169, ${alpha})`;
    const r = parseInt(cleaned.slice(0, 2), 16);
    const g = parseInt(cleaned.slice(2, 4), 16);
    const b = parseInt(cleaned.slice(4, 6), 16);
    return `rgba(${clamp(r, 0, 255)}, ${clamp(g, 0, 255)}, ${clamp(b, 0, 255)}, ${alpha})`;
};

const readMoodPalette = () => {
    const styles = getComputedStyle(document.documentElement);
    const accent = styles.getPropertyValue('--mood-accent').trim() || '#5fa3a9';
    const accent2 = styles.getPropertyValue('--mood-accent-2').trim() || '#8f6ea9';
    const accent3 = styles.getPropertyValue('--mood-accent-3').trim() || '#d9b8a6';
    return { accent, accent2, accent3 };
};

// Simple noise function for organic wave movement
function createNoise() {
    const permutation = Array.from({ length: 256 }, (_, i) => i);
    for (let i = 255; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [permutation[i], permutation[j]] = [permutation[j], permutation[i]];
    }
    const p = [...permutation, ...permutation];

    const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
    const lerp = (a: number, b: number, t: number) => a + t * (b - a);
    const grad = (hash: number, x: number) => {
        const h = hash & 15;
        const grad = 1 + (h & 7);
        return (h & 8 ? -grad : grad) * x;
    };

    return (x: number) => {
        const X = Math.floor(x) & 255;
        x -= Math.floor(x);
        const u = fade(x);
        return lerp(grad(p[X], x), grad(p[X + 1], x - 1), u);
    };
}

export default function AnimatedBackground({ className = '' }: AnimatedBackgroundProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const animationRef = useRef<number>(0);
    const noiseRef = useRef(createNoise());
    const paletteRef = useRef(readMoodPalette());

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        let width = window.innerWidth;
        let height = window.innerHeight;

        const resize = () => {
            width = window.innerWidth;
            height = window.innerHeight;
            canvas.width = width;
            canvas.height = height;
        };

        resize();
        window.addEventListener('resize', resize);

        const noise = noiseRef.current;

        const getWaves = () => {
            const { accent, accent2, accent3 } = paletteRef.current;
            return [
                { amplitude: 55, frequency: 0.0028, speed: 0.00025, color: toRgba(accent, 0.12), offset: 0 },
                { amplitude: 70, frequency: 0.002, speed: 0.00032, color: toRgba(accent2, 0.1), offset: 90 },
                { amplitude: 45, frequency: 0.0036, speed: 0.0002, color: toRgba(accent2, 0.08), offset: 170 },
                { amplitude: 65, frequency: 0.0023, speed: 0.0003, color: toRgba(accent3, 0.06), offset: 140 },
            ];
        };

        let time = 0;

        const draw = () => {
            animationRef.current = requestAnimationFrame(draw);
            time += 1;

            // Clear with dark background
            ctx.fillStyle = 'rgb(14, 16, 22)';
            ctx.fillRect(0, 0, width, height);

            // Draw each wave layer
            const waves = getWaves();
            waves.forEach((wave) => {
                ctx.beginPath();
                ctx.moveTo(0, height);

                for (let x = 0; x <= width; x += 3) {
                    const noiseVal = noise(x * wave.frequency + time * wave.speed);
                    const y = height * 0.5 + wave.offset + noiseVal * wave.amplitude +
                              Math.sin(x * wave.frequency * 2 + time * wave.speed * 0.5) * wave.amplitude * 0.5;
                    ctx.lineTo(x, y);
                }

                ctx.lineTo(width, height);
                ctx.closePath();
                ctx.fillStyle = wave.color;
                ctx.fill();
            });

            // Add subtle gradient overlay for depth
            const gradient = ctx.createRadialGradient(
                width * 0.5, height * 0.3, 0,
                width * 0.5, height * 0.3, width * 0.8
            );
            const { accent, accent2 } = paletteRef.current;
            gradient.addColorStop(0, toRgba(accent, 0.05));
            gradient.addColorStop(0.5, toRgba(accent2, 0.025));
            gradient.addColorStop(1, 'transparent');
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, width, height);

            // Floating particles
            const particleCount = 18;
            for (let i = 0; i < particleCount; i++) {
                const x = Math.abs((noise(i * 0.1 + time * 0.0001) + 1) * 0.5) * width;
                const y = Math.abs((noise(i * 0.2 + time * 0.00015 + 100) + 1) * 0.5) * height;
                const size = Math.max(0.5, Math.abs(noise(i * 0.3) + 1) * 1.5 + 0.5);
                const alpha = Math.max(0.04, Math.abs(noise(i * 0.4 + time * 0.0002) + 1) * 0.1);

                ctx.beginPath();
                ctx.arc(x, y, size, 0, Math.PI * 2);
                ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
                ctx.fill();
            }
        };

        draw();

        const handleMoodChange = () => {
            paletteRef.current = readMoodPalette();
        };

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
            className={`absolute inset-0 w-full h-full pointer-events-none ${className}`}
        />
    );
}
