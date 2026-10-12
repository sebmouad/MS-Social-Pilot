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
 *
 * Both scales are CSS variables, set per theme in `src/app/globals.css`
 * (Facebook by default, Warm on request), so a theme is one attribute on
 * `<html>` and no class changes.
 */
const STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900];

/** A colour scale read from the theme's CSS variables (`globals.css`). */
function themed(name: string): Record<number, string> {
  return Object.fromEntries(STEPS.map((step) => [step, `rgb(var(--${name}-${step}) / <alpha-value>)`]));
}

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: themed('brand'),
        slate: themed('slate'),
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
