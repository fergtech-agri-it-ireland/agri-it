/** @type {import('tailwindcss').Config} */
// Fitness-tracker look: white cards on a soft grey-green ground, one green accent,
// amber only when something needs doing. Status never carried by colour alone.
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
        ok: { DEFAULT: 'rgb(var(--ok) / <alpha-value>)', bg: 'rgb(var(--ok-bg) / <alpha-value>)' },
        money: { DEFAULT: 'rgb(var(--money) / <alpha-value>)', light: 'rgb(var(--money-light) / <alpha-value>)' },
        silage: 'rgb(var(--silage) / <alpha-value>)'
      },
      fontFamily: {
        sans: ['Figtree', 'system-ui', 'sans-serif'],
        display: ['Figtree', 'system-ui', 'sans-serif']
      },
      fontSize: { base: ['1rem', '1.45rem'] },
      // 48px: comfortable for a thumb, without the oversized look
      minHeight: { tap: '3rem' },
      minWidth: { tap: '3rem' },
      boxShadow: { lift: '0 1px 2px rgba(16,26,21,0.05)', float: '0 6px 18px rgba(11,122,85,0.35)' }
    }
  },
  plugins: []
};
