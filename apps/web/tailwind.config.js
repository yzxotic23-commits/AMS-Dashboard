/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        ams: {
          canvas: '#EBDFD7',
          surface: '#FFFFFF',
          'surface-card': '#FCF9F7',
          'surface-muted': '#F1F1F1',
          ink: '#060606',
          'ink-sub': '#292D32',
          muted: '#797979',
          faint: '#9A9A9A',
          line: 'rgba(6, 6, 6, 0.08)',
          accent: '#E65F2B',
          success: '#1A932E',
          warn: '#DFA510',
          danger: '#EE201C',
          blue: '#2B5CE6',
          sidebar: '#000000',
          'sidebar-text': '#F1F1F1',
        },
      },
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'Inter', 'ui-sans-serif', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
      },
      borderRadius: {
        card: '14px',
        pill: '24px',
      },
      boxShadow: {
        card: '0 4px 6px rgba(0, 0, 0, 0.02)',
        elevated: '0 8px 15px rgba(19, 15, 57, 0.12)',
      },
    },
  },
  plugins: [],
  safelist: [
    'site-context-strip--all',
    'site-context-strip--my',
    'site-context-strip--pp',
    'engine-slot-bubble--online',
    'engine-slot-bubble--linking',
    'engine-slot-bubble--feeding',
    'engine-slot-bubble--offline',
  ],
};
