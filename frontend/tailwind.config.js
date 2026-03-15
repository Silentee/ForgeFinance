/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Base surface palette — deep slate
        surface: {
          950: '#0a0c0f',
          900: '#0f1218',
          800: '#161b24',
          700: '#1e2636',
          600: '#26334a',
          500: '#2e3f5c',
        },
        // Off-white text hierarchy
        ink: {
          100: '#f0ede8',   // primary text
          200: '#c8c3bb',   // secondary text
          300: '#8a8580',   // muted/placeholder
          400: '#4a4845',   // disabled
        },
        // Amber accent — positive values, income, CTAs
        amber: {
          400: '#f5a623',
          500: '#e8950f',
          600: '#c97d0a',
        },
        // Rose — negative, over budget, debt
        rose: {
          400: '#f87171',
          500: '#ef4444',
          600: '#dc2626',
        },
        // Teal — neutral data, balances
        teal: {
          400: '#34d4b1',
          500: '#20b9987',
          600: '#0d9488',
        },
        // Grid line color
        grid: 'rgba(255,255,255,0.06)',
      },
      fontFamily: {
        // Display/UI labels
        sans: ['Sora', 'system-ui', 'sans-serif'],
        // Numbers, data, monospaced values
        mono: ['DM Mono', 'ui-monospace', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.65rem', { lineHeight: '1rem' }],
      },
      backgroundImage: {
        'grid-lines': `
          linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px),
          linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)
        `,
      },
      backgroundSize: {
        'grid-40': '40px 40px',
      },
      boxShadow: {
        'glow-amber': '0 0 20px rgba(245, 166, 35, 0.15)',
        'glow-teal':  '0 0 20px rgba(52, 212, 177, 0.12)',
        'card': '0 1px 0 rgba(255,255,255,0.05), 0 4px 24px rgba(0,0,0,0.4)',
      },
      borderColor: {
        DEFAULT: 'rgba(255,255,255,0.08)',
      },
      animation: {
        'fade-in':    'fadeIn 0.3s ease-out',
        'slide-up':   'slideUp 0.3s ease-out',
        'count-up':   'countUp 0.6s ease-out',
      },
      keyframes: {
        fadeIn:  { from: { opacity: '0' },                  to: { opacity: '1' } },
        slideUp: { from: { opacity: '0', transform: 'translateY(8px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
      },
    },
  },
  plugins: [],
}
