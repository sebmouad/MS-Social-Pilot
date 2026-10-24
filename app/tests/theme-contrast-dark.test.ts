import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { THEMES } from '@/lib/themes';

const css = readFileSync(new URL('../src/styles/tokens.css', import.meta.url), 'utf8');
const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a: string, b: string) => { const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
const block = (theme: string, mode: 'dark' | 'system') => mode === 'dark'
  ? css.match(new RegExp(`:root\\[data-theme="${theme}"\\]\\[data-mode="dark"\\]\\s*\\{([^}]+)\\}`))?.[1] ?? ''
  : css.match(new RegExp(`:root\\[data-theme="${theme}"\\]\\[data-mode="system"\\]\\s*\\{([^}]+)\\}`))?.[1] ?? '';
const token = (body: string, name: string) => body.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`))?.[1];

const TEXT: Array<[string, string]> = [['ink', 'canvas'], ['ink', 'surface'], ['ink-soft', 'surface'], ['ink-faint', 'surface'], ['ink-soft', 'surface-muted'], ['on-accent', 'accent'], ['accent', 'surface'], ['danger', 'surface'], ['warning', 'surface'], ['rail-ink', 'rail-bg'], ['rail-active-ink', 'rail-bg']];
const UI: Array<[string, string]> = [['control-border', 'surface'], ['focus', 'surface'], ['line-strong', 'canvas']];

describe('dark mode palettes', () => {
  for (const theme of THEMES) {
    it(`${theme.name}: dark text meets WCAG AA and controls meet 3:1`, () => {
      const body = block(theme.id, 'dark');
      expect(body, `${theme.id} dark block`).not.toBe('');
      for (const [fg, bg] of TEXT) {
        const [a, b] = [token(body, fg), token(body, bg)];
        expect(a && b, `${theme.id}: ${fg}/${bg} tokens`).toBeTruthy();
        expect(ratio(a!, b!), `${theme.id} dark: ${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
      }
      for (const [fg, bg] of UI) {
        const [a, b] = [token(body, fg), token(body, bg)];
        expect(ratio(a!, b!), `${theme.id} dark: ${fg} on ${bg}`).toBeGreaterThanOrEqual(fg === 'line-strong' ? 1.4 : 3);
      }
    });
    it(`${theme.name}: "match device" uses the same dark palette`, () => {
      expect(block(theme.id, 'system').replace(/\s+/g, ' ').trim()).toBe(block(theme.id, 'dark').replace(/\s+/g, ' ').trim());
    });
  }
});
