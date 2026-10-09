import type { Config } from 'tailwindcss';

/**
 * The palette follows Facebook's own interface, because that is where every
 * post made here ends up: the same blue, the same greys, the same quiet grey
 * page under white surfaces. Moving between this app and the Page should not
 * feel like changing products.
 *
 * Two adjustments for contrast. Facebook's #1877F2 carries white text at only
 * 4.2:1, under the 4.5:1 that normal-size text needs, so it is the accent
 * (`brand-500`: underlines, icons, rings) and buttons use `brand-600`, which
 * passes. And `slate` is redefined wholesale rather than added beside, so the
 * hundreds of `text-slate-*` and `bg-slate-*` classes already in the screens
 * move to Facebook's greys together instead of half of them staying cool blue.
 */
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#e7f3ff',
          100: '#dbebff',
          200: '#b8d6fe',
          300: '#86b9fb',
          400: '#4e97f6',
          500: '#1877f2',
          600: '#1467d6',
          700: '#0f57b8',
          800: '#0c4795',
          900: '#0a3a78',
        },
        slate: {
          50: '#f7f8fa',
          100: '#f0f2f5',
          200: '#e4e6eb',
          300: '#ced0d4',
          400: '#8a8d91',
          500: '#6a6d72',
          600: '#65676b',
          700: '#3e4042',
          800: '#1c1e21',
          900: '#050505',
        },
      },
      fontFamily: {
        // Facebook's own stack: the platform's UI face on each system.
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI Historic"',
          '"Segoe UI"',
          'Helvetica',
          'Arial',
          'sans-serif',
        ],
      },
      boxShadow: {
        // The single soft edge Facebook puts under every surface.
        surface: '0 1px 2px rgba(0, 0, 0, 0.2)',
        bar: '0 1px 2px rgba(0, 0, 0, 0.1), 0 2px 4px rgba(0, 0, 0, 0.04)',
      },
    },
  },
  plugins: [],
};

export default config;
