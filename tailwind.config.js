/* eslint-disable import/no-anonymous-default-export */
import typography from '@tailwindcss/typography';
import aspectRatio from '@tailwindcss/aspect-ratio';

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        'lofi': {
          50: 'var(--color-lofi-50)',
          100: 'var(--color-lofi-100)',
          200: 'var(--color-lofi-200)',
          300: 'var(--color-lofi-300)',
          400: 'var(--color-lofi-400)',
          500: 'var(--color-lofi-500)',
          600: 'var(--color-lofi-600)',
          700: 'var(--color-lofi-700)',
          800: 'var(--color-lofi-800)',
          900: 'var(--color-lofi-900)',
          950: 'var(--color-lofi-950)',
        },
        'accent': {
          pink: 'var(--color-accent-pink)',
          blue: 'var(--color-accent-blue)',
          peach: 'var(--color-accent-peach)',
        }
      },
      animation: {
        'pulse-slow': 'pulse 4s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'fade-in': 'fadeIn 0.5s ease-in-out',
        'fade-in-up': 'fadeInUp 0.6s ease-out',
        'slide-up': 'slideUp 0.5s ease-out',
        'slide-down': 'slideDown 0.5s ease-out',
        'scale-in': 'scaleIn 0.3s ease-out',
        'bounce-subtle': 'bounceSubtle 2s ease-in-out infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        fadeInUp: {
          '0%': { opacity: '0', transform: 'translateY(20px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        slideUp: {
          '0%': { transform: 'translateY(10px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        slideDown: {
          '0%': { transform: 'translateY(-10px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        scaleIn: {
          '0%': { transform: 'scale(0.95)', opacity: '0' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
        bounceSubtle: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-5px)' },
        },
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-jetbrains-mono)', 'monospace'],
      },
      container: {
        center: true,
        padding: {
          DEFAULT: '1rem',
          sm: '2rem',
          lg: '4rem',
          xl: '5rem',
          '2xl': '6rem',
        },
      },
      boxShadow: {
        'glass': '0 8px 32px 0 rgba(156, 111, 196, 0.1)',
        'glass-lg': '0 12px 48px 0 rgba(156, 111, 196, 0.15)',
        'lofi': '0 4px 16px -2px rgba(156, 111, 196, 0.2)',
        'lofi-lg': '0 10px 32px -4px rgba(156, 111, 196, 0.25)',
      },
      backdropBlur: {
        xs: '2px',
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
      },
    },
  },
  plugins: [
    typography,
    aspectRatio,
  ],
} 