'use client';

import { useEffect, useRef } from 'react';

interface AnimatedBackgroundProps {
    className?: string;
}

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

        // Wave configuration for lofi aesthetic
        const waves = [
            { amplitude: 60, frequency: 0.003, speed: 0.0003, color: 'rgba(168, 85, 247, 0.15)', offset: 0 },      // Purple
            { amplitude: 80, frequency: 0.002, speed: 0.0004, color: 'rgba(156, 111, 196, 0.12)', offset: 100 },   // Lofi purple
            { amplitude: 50, frequency: 0.004, speed: 0.0002, color: 'rgba(236, 72, 153, 0.10)', offset: 200 },    // Pink
            { amplitude: 70, frequency: 0.0025, speed: 0.00035, color: 'rgba(59, 130, 246, 0.08)', offset: 150 },  // Blue
        ];

        let time = 0;

        const draw = () => {
            animationRef.current = requestAnimationFrame(draw);
            time += 1;

            // Clear with dark background
            ctx.fillStyle = 'rgb(2, 6, 23)'; // slate-950
            ctx.fillRect(0, 0, width, height);

            // Draw each wave layer
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
            gradient.addColorStop(0, 'rgba(168, 85, 247, 0.05)');
            gradient.addColorStop(0.5, 'rgba(156, 111, 196, 0.03)');
            gradient.addColorStop(1, 'transparent');
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, width, height);

            // Floating particles
            const particleCount = 30;
            for (let i = 0; i < particleCount; i++) {
                const x = Math.abs((noise(i * 0.1 + time * 0.0001) + 1) * 0.5) * width;
                const y = Math.abs((noise(i * 0.2 + time * 0.00015 + 100) + 1) * 0.5) * height;
                const size = Math.max(0.5, Math.abs(noise(i * 0.3) + 1) * 1.5 + 0.5);
                const alpha = Math.max(0.05, Math.abs(noise(i * 0.4 + time * 0.0002) + 1) * 0.15);

                ctx.beginPath();
                ctx.arc(x, y, size, 0, Math.PI * 2);
                ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
                ctx.fill();
            }
        };

        draw();

        return () => {
            window.removeEventListener('resize', resize);
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
