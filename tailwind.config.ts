import type { Config } from 'tailwindcss';

/**
 * App Portfolio Command Center — shares the culinary spice palette with the
 * sibling "Weeknight Meal Planner" family of apps so every tracked
 * implementation feels like part of the same product family.
 */
const config: Config = {
  darkMode: 'class',
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        tomato: {
          50: '#FFF1ED', 100: '#FFE0D6', 200: '#FFBFA8', 300: '#FF9B7A',
          400: '#F4714D', 500: '#E94B23', 600: '#C73818', 700: '#A12A12',
          800: '#7A1E0B', 900: '#561406',
        },
        basil: {
          50: '#F2FAEC', 100: '#DFF5D2', 200: '#B8E8A1', 300: '#8BD56D',
          400: '#5FBD43', 500: '#3FA52D', 600: '#2D8621', 700: '#1F6915',
          800: '#144D0C', 900: '#0B3306',
        },
        turmeric: {
          50: '#FFF8E8', 100: '#FFEFC1', 200: '#FFE08A', 300: '#FECC49',
          400: '#F4B721', 500: '#D89500', 600: '#B57900', 700: '#8C5C00',
          800: '#654100', 900: '#422900',
        },
        paprika: {
          50: '#FDEEF1', 100: '#FAD3DA', 200: '#F5A6B5', 300: '#ED6F89',
          400: '#DE3F61', 500: '#C9184A', 600: '#A6113D', 700: '#830B30',
          800: '#5F0622', 900: '#3F0316',
        },
        lemon: {
          50: '#FFFAEB', 100: '#FFF1C9', 200: '#FFE388', 300: '#FCD047',
          400: '#F7BC1A', 500: '#DEA700', 600: '#B68700', 700: '#8C6700',
          800: '#634900', 900: '#3F2E00',
        },
        eggplant: {
          50: '#F5F0FA', 100: '#E5D6F2', 200: '#CBADE3', 300: '#AC7FD0',
          400: '#8A56B8', 500: '#6A4C93', 600: '#543876', 700: '#3F2A5A',
          800: '#2B1C3F', 900: '#1A1028',
        },
        lime: {
          50: '#F8FBEC', 100: '#EEF6CC', 200: '#DCEC9A', 300: '#C7DD63',
          400: '#A7C957', 500: '#82A534', 600: '#647E25', 700: '#4A5E1B',
          800: '#324010', 900: '#1E260A',
        },
        pepper: {
          50: '#F2F4F4', 100: '#DDE2E3', 200: '#B8C2C5', 300: '#8C9CA1',
          400: '#5E737A', 500: '#3F5560', 600: '#283D3B', 700: '#1F2D2C',
          800: '#14201F', 900: '#0B1312',
        },
        flour: {
          50: '#FFFDFA', 100: '#FFF8F0', 200: '#FFF1E0', 300: '#FFE5C5',
          400: '#FFD9A8', 500: '#F4C68A', 600: '#D9A662', 700: '#A87A45',
          800: '#7A572F', 900: '#4E381E',
        },
        butter: {
          50: '#FFFEFA', 100: '#FFF8E5', 200: '#FFEFC9', 300: '#FFE09A',
          400: '#FFCE68', 500: '#E5B23F', 600: '#C09030', 700: '#8F6C20',
          800: '#604815', 900: '#3D2D0D',
        },
        molasses: {
          50: '#F8F0EE', 100: '#EBD9D2', 200: '#D3B0A4', 300: '#B58776',
          400: '#94614F', 500: '#73463A', 600: '#5A332A', 700: '#42241D',
          800: '#2D1813', 900: '#1B0D0A',
        },
        danger: { 100: '#FEE2E2', 500: '#DC2626', 700: '#B91C1C' },
        success: { 100: '#DCFCE7', 500: '#16A34A', 700: '#15803D' },
      },
      fontFamily: {
        sans: [
          'Inter', 'ui-sans-serif', 'system-ui', '-apple-system',
          'Segoe UI', 'Roboto', 'sans-serif',
        ],
        display: [
          'Fraunces', 'ui-serif', 'Georgia', 'Cambria', '"Times New Roman"',
          'Times', 'serif',
        ],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(31,45,44,0.04), 0 8px 24px -12px rgba(31,45,44,0.12)',
        warm: '0 1px 2px rgba(233,75,35,0.10), 0 12px 28px -14px rgba(201,24,74,0.18)',
        plate: '0 2px 6px rgba(146,64,14,0.10), 0 18px 36px -16px rgba(146,64,14,0.22)',
      },
      borderRadius: {
        xl2: '1.25rem',
      },
      keyframes: {
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'pulse-ring': {
          '0%': { boxShadow: '0 0 0 0 rgba(233,75,35,0.35)' },
          '70%': { boxShadow: '0 0 0 6px rgba(233,75,35,0)' },
          '100%': { boxShadow: '0 0 0 0 rgba(233,75,35,0)' },
        },
      },
      animation: {
        'fade-up': 'fade-up 320ms ease-out both',
        'pulse-ring': 'pulse-ring 1.8s ease-out infinite',
      },
    },
  },
  plugins: [],
};

export default config;
