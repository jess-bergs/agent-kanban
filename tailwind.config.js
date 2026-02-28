/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        surface: {
          900: '#0f1117',
          800: '#1a1d27',
          700: '#252836',
          600: '#2f3344',
        },
        accent: {
          blue: '#3b82f6',
          green: '#22c55e',
          amber: '#f59e0b',
          orange: '#f97316',
          red: '#ef4444',
          purple: '#a855f7',
          cyan: '#06b6d4',
        }
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      }
    },
  },
  plugins: [],
}
