import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(path, 'utf8');
const components = read('src/styles/components.css');
const tokens = read('src/styles/tokens.css');
const responsive = read('src/styles/responsive.css');
const globals = read('src/app/globals.css');

/** Body of the first @media block whose query starts with `query`. */
const media = (css: string, query: string) => {
  const start = css.indexOf(`@media ${query}`);
  expect(start, `missing @media ${query}`).toBeGreaterThanOrEqual(0);
  return css.slice(start, css.indexOf('\n}\n', start) + 3);
};

describe('shared responsive CSS (phone 390px, tablet 768px)', () => {
  it('is loaded after the component styles', () => {
    expect(globals.indexOf('responsive.css')).toBeGreaterThan(globals.indexOf('components.css'));
  });
  it('never lets the page scroll sideways', () => {
    expect(responsive).toMatch(/html, body \{[^}]*overflow-x: clip/);
  });
  it('turns tables into labeled cards on phones and scrolls them locally on tablets', () => {
    expect(components).toContain('.ui-table--stack td[data-label]::before');
    expect(tokens).toMatch(/@media \(max-width: 760px\)[\s\S]*\.ui-table \{ min-width: 620px; \}/);
  });
  it('makes dialogs full-screen on phones with safe-area insets', () => {
    const phone = media(responsive, '(max-width: 640px)');
    expect(phone).toContain('height: 100dvh');
    expect(phone).toContain('env(safe-area-inset-top)');
    expect(phone).toContain('env(safe-area-inset-bottom)');
  });
  it('keeps drawers full width with safe-area padding on phones', () => {
    expect(components).toMatch(/@media \(max-width: 640px\) \{ \.ui-drawer \{ width: 100vw/);
    expect(components).toContain('calc(14px + env(safe-area-inset-bottom))');
    expect(media(responsive, '(max-width: 640px)')).toContain('.ui-drawer__header');
  });
  it('gives 44px touch targets by width, not only by pointer type', () => {
    const phone = media(responsive, '(max-width: 760px)');
    expect(phone).toContain('.ui-button');
    expect(phone).toContain('.ui-icon-button');
    expect(phone).toContain('min-height: var(--control-height-touch)');
    expect(tokens).toContain('--control-h-touch: 44px');
  });
  it('uses 16px form text on phones to avoid iOS zoom', () => {
    expect(media(responsive, '(max-width: 760px)')).toMatch(/\.ui-input[^}]*font-size: var\(--text-lg\)/);
  });
  it('keeps toasts above the bottom navigation and inside the safe area', () => {
    expect(components).toContain('bottom: calc(76px + env(safe-area-inset-bottom))');
    expect(media(responsive, '(max-width: 760px)')).toMatch(/\.ui-toasts \{ left: max\(12px, env\(safe-area-inset-left\)\)/);
  });
  it('keeps tabs scrollable on one row and page header actions wrapping', () => {
    expect(components).toMatch(/\.ui-tabs__list \{[^}]*overflow-x: auto/);
    expect(components).toMatch(/\.ui-tabs__tab \{[^}]*white-space: nowrap/);
    expect(components).toMatch(/\.ui-page-header__actions \{[^}]*flex-wrap: wrap/);
    expect(components).toContain('.ui-page-header__actions { flex: 1 0 100%');
  });
  it('collapses metric grids at tablet, phone and very narrow widths', () => {
    expect(globals).toContain('@media (max-width: 850px) { .metric-grid { grid-template-columns: repeat(2');
    expect(responsive).toContain('@media (max-width: 340px) { .metric-grid { grid-template-columns: minmax(0, 1fr)');
  });
  it('turns the module rail into bottom navigation with safe-area padding below 760px', () => {
    expect(tokens).toMatch(/\.shell-module-rail \{ position: fixed[^}]*env\(safe-area-inset-bottom\)/);
  });
});
