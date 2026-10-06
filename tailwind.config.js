/** @type {import('tailwindcss').Config} */
// Tokens chosen for sunlight legibility: near-black ink on white cards,
// status never carried by colour alone (always icon + words).
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Every colour is a CSS variable (src/index.css) so day, sunlight and dawn modes swap together.
        ink: 'rgb(var(--ink) / <alpha-value>)',
        muted: 'rgb(var(--muted) / <alpha-value>)',
        line: 'rgb(var(--line) / <alpha-value>)',
        pasture: 'rgb(var(--pasture) / <alpha-value>)',
        card: 'rgb(var(--card) / <alpha-value>)',
        track: 'rgb(var(--track) / <alpha-value>)',
        accent: 'rgb(var(--accent) / <alpha-value>)',
        inverse: 'rgb(var(--inverse) / <alpha-value>)',
        oninverse: 'rgb(var(--oninverse) / <alpha-value>)',
        onhivis: 'rgb(var(--onhivis) / <alpha-value>)',
        field: { DEFAULT: 'rgb(var(--field) / <alpha-value>)', dark: 'rgb(var(--field-dark) / <alpha-value>)', light: 'rgb(var(--field-light) / <alpha-value>)' },
        hivis: { DEFAULT: 'rgb(var(--hivis) / <alpha-value>)', dark: 'rgb(var(--hivis-dark) / <alpha-value>)' },
        danger: { DEFAULT: 'rgb(var(--danger) / <alpha-value>)', bg: 'rgb(var(--danger-bg) / <alpha-value>)' },
        warn: { DEFAULT: 'rgb(var(--warn) / <alpha-value>)', bg: 'rgb(var(--warn-bg) / <alpha-value>)' },
        ok: { DEFAULT: 'rgb(var(--ok) / <alpha-value>)', bg: 'rgb(var(--ok-bg) / <alpha-value>)' }
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
