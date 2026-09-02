import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/app/**/*.{ts,tsx}',
    './src/components/**/*.{ts,tsx}',
    './src/hooks/**/*.{ts,tsx}',
    './src/utils/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        navy: {
          50: '#f0f4f8',
          100: '#d9e2ec',
          200: '#bcccdc',
          300: '#9fb3c8',
          400: '#829ab1',
          500: '#627d98',
          600: '#486581',
          700: '#334e68',
          800: '#243b53',
          900: '#102a43',
          950: '#0a1929',
        },
        blue: {
          50: '#eef5ff',
          100: '#d9edff',
          200: '#bce0ff',
          300: '#8eccff',
          400: '#53b0ff',
          500: '#2b8fff',
          600: '#1073e0',
          700: '#0057b9',
          800: '#004693',
          900: '#003670',
          950: '#00214d',
        },
        white: '#ffffff',
        ink: {
          50: '#f8fafc',
          100: '#f1f5f9',
          200: '#e2e8f0',
          300: '#cbd5e1',
          400: '#94a3b8',
          500: '#64748b',
          600: '#475569',
          700: '#334155',
          800: '#1e293b',
          900: '#0f172a',
          950: '#020617',
        },
        good: {
          50: '#f0fdf4',
          100: '#dcfce7',
          200: '#bbf7d0',
          300: '#86efac',
          400: '#4ade80',
          500: '#22c55e',
          600: '#16a34a',
          700: '#15803d',
          800: '#166534',
          900: '#14532d',
          950: '#052e16',
        },
      },
      fontFamily: {
        sans: [
          'Inter',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'sans-serif',
        ],
      },
      typography: {
        DEFAULT: {
          css: {
            color: '#1e293b',
            a: { color: '#2b8fff', fontWeight: '600' },
            h1: { color: '#102a43', fontWeight: '700' },
            h2: { color: '#102a43', fontWeight: '600' },
            h3: { color: '#102a43', fontWeight: '600' },
            strong: { color: '#102a43', fontWeight: '600' },
          },
        },
      },
    },
  },
  plugins: [],
};

export default config;
