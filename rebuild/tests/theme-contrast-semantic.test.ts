import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { THEMES } from '@/lib/themes';

const css = readFileSync(join(process.cwd(), 'src/styles/tokens.css'), 'utf8');
const base = css.match(/:root\s*\{([^}]+)\}/)?.[1] ?? '';

function themeValue(themeId: string, name: string): string {
  const override = css.match(new RegExp(`:root\\[data-theme="${themeId}"\\]\\s*\\{([^}]+)\\}`))?.[1] ?? '';
  const pattern = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6}|white)`);
  const raw = override.match(pattern)?.[1] ?? base.match(pattern)?.[1];
  if (!raw) throw new Error(`token --${name} missing for ${themeId}`);
  return raw === 'white' ? '#ffffff' : raw;
}

function luminance(hex: string) {
  const [red, green, blue] = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrast(first: string, second: string) {
  const [lighter, darker] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

const TEXT_PAIRS: Array<[string, string]> = [
  ['accent', 'accent-soft'], ['accent', 'surface'], ['accent', 'surface-muted'], ['accent', 'surface-raised'], ['accent', 'canvas'],
  ['warning', 'warning-soft'], ['warning', 'surface'], ['warning', 'surface-muted'],
  ['danger', 'danger-soft'], ['danger', 'surface'], ['danger', 'surface-muted'],
  ['on-danger', 'danger'],
  ['placeholder', 'surface'],
  ['ink', 'selection'], ['ink', 'canvas'], ['ink', 'surface-hover'],
  ['ink-soft', 'accent-soft'], ['ink-soft', 'surface-hover'],
  ['ink-faint', 'surface-hover'], ['ink-faint', 'accent-soft'], ['ink-faint', 'line-subtle'],
];
const NON_TEXT_PAIRS: Array<[string, string]> = [
  ['focus', 'surface'], ['focus', 'canvas'], ['focus', 'surface-muted'], ['focus', 'surface-raised'],
  // The rail restyles its focus ring with the active label colour.
  ['rail-active-ink', 'rail-bg'],
  // Form-field boundaries (WCAG 1.4.11) use --control-border, not the decorative --line-strong.
  ['control-border', 'surface'], ['control-border', 'canvas'], ['control-border', 'surface-muted'], ['control-border', 'surface-raised'],
];

describe('semantic token contrast in every theme', () => {
  for (const theme of THEMES) {
    it(`${theme.name}: status and soft-surface text meets WCAG AA`, () => {
      for (const [ink, surface] of TEXT_PAIRS) {
        expect(contrast(themeValue(theme.id, ink), themeValue(theme.id, surface)), `${theme.name}: ${ink} on ${surface}`).toBeGreaterThanOrEqual(4.5);
      }
    });
    it(`${theme.name}: focus ring and control borders meet 3:1`, () => {
      for (const [ink, surface] of NON_TEXT_PAIRS) {
        expect(contrast(themeValue(theme.id, ink), themeValue(theme.id, surface)), `${theme.name}: ${ink} on ${surface}`).toBeGreaterThanOrEqual(3);
      }
    });
  }
});
