import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef4ff',
          100: '#dae6ff',
          200: '#bdd3ff',
          300: '#90b6ff',
          400: '#5b8dff',
          500: '#3563e9',
          600: '#2549c6',
          700: '#1e3aa0',
          800: '#1d3380',
          900: '#1d2f68',
        },
      },
    },
  },
  plugins: [],
};

export default config;
