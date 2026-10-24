import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { THEMES } from '@/lib/themes';

const tokens = readFileSync(new URL('../src/styles/tokens.css', import.meta.url), 'utf8');
const components = readFileSync(new URL('../src/styles/components.css', import.meta.url), 'utf8');

const rgb = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const luminance = (channels: number[]) => {
  const [r, g, b] = channels.map(c => c / 255).map(c => c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};
const ratio = (a: number[], b: number[]) => { const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m); return (x! + 0.05) / (y! + 0.05); };
const mix = (top: number[], bottom: number[], amount: number) => top.map((c, i) => Math.round(c * amount + bottom[i]! * (1 - amount)));

const body = (source: string, selector: string) => source.match(new RegExp(`${selector.replace(/[[\]"=.]/g, '\\$&')}\\s*\\{([^}]+)\\}`))?.[1] ?? '';
const read = (block: string, name: string) => block.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`))?.[1];

/** Resolve a token for a theme and mode exactly like the cascade: dark block overrides the theme block, which overrides :root. */
function resolver(theme: string, mode: 'light' | 'dark') {
  const layers = [body(tokens, ':root'), body(tokens, `:root[data-theme="${theme}"]`), mode === 'dark' ? body(tokens, `:root[data-theme="${theme}"][data-mode="dark"]`) : '', body(components, ':root'), mode === 'dark' ? body(components, ':root[data-mode="dark"]') : ''];
  return (name: string) => {
    for (const layer of [...layers].reverse()) { const value = read(layer, name); if (value) return rgb(value); }
    throw new Error(`${theme}/${mode}: token --${name} not found`);
  };
}

const MODULES = ['home', 'publishing', 'inbox', 'analytics', 'ads', 'tasks', 'agency', 'settings', 'root'];

describe('shared component color pairs', () => {
  for (const theme of THEMES) for (const mode of ['light', 'dark'] as const) {
    it(`${theme.name} ${mode}: text on component surfaces meets WCAG AA`, () => {
      const t = resolver(theme.id, mode);
      const pairs: Array<[string, string]> = [
        ['success', 'success-soft'], ['success', 'surface'], ['success', 'surface-muted'],
        ['ink', 'accent-soft'], ['ink', 'surface-hover'], ['ink', 'surface-muted'], ['ink-soft', 'surface-hover'],
        ['accent', 'surface-hover'], ['danger', 'surface-muted'], ['on-danger', 'danger'],
      ];
      for (const [fg, bg] of pairs) expect(ratio(t(fg), t(bg)), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
    });
    it(`${theme.name} ${mode}: module badge text and icon chips stay readable`, () => {
      const t = resolver(theme.id, mode);
      for (const id of MODULES) {
        const soft = mix(t(`mod-${id}`), t('surface'), 0.14);
        expect(ratio(t('ink'), soft), `ink on ${id} soft`).toBeGreaterThanOrEqual(4.5);
        expect(ratio(t(`mod-${id}`), soft), `${id} icon on soft chip (non-text)`).toBeGreaterThanOrEqual(1.8);
      }
    });
  }
});
