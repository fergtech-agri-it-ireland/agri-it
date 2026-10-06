/** @type {import('tailwindcss').Config} */
// Tokens chosen for sunlight legibility: near-black ink on white cards,
// status never carried by colour alone (always icon + words).
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#17211C',
        muted: '#4D5B53',
        line: '#C9D3CC',
        pasture: '#EEF2EE',
        field: { DEFAULT: '#1D4D36', dark: '#143826', light: '#D7E6DC' },
        hivis: { DEFAULT: '#FFC61A', dark: '#E0A800' },
        danger: { DEFAULT: '#A8231A', bg: '#FBE4E1' },
        warn: { DEFAULT: '#7A4A00', bg: '#FFF1CC' },
        ok: { DEFAULT: '#1E6B43', bg: '#E1F2E7' }
      },
      fontFamily: {
        sans: ['"Atkinson Hyperlegible"', 'system-ui', 'sans-serif'],
        display: ['"Barlow Condensed"', '"Arial Narrow"', 'system-ui', 'sans-serif']
      },
      fontSize: { base: ['1.0625rem', '1.5rem'] },
      minHeight: { tap: '3.5rem' },
      minWidth: { tap: '3.5rem' },
      boxShadow: { lift: '0 1px 0 rgba(23,33,28,0.08), 0 2px 6px rgba(23,33,28,0.06)' }
    }
  },
  plugins: []
};
