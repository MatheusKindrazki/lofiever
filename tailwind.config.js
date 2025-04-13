/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        'lofi': {
          50: '#f7f5fb',
          100: '#eae4f6',
          200: '#d7cbee',
          300: '#bca6e0',
          400: '#9c7bd0',
          500: '#8459c0',
          600: '#7045a8',
          700: '#5d3889',
          800: '#4c3071',
          900: '#41295d',
          950: '#28173b',
        },
      },
      animation: {
        'pulse-slow': 'pulse 4s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      }
    },
  },
  plugins: [],
} 