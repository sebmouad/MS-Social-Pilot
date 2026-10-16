import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { THEMES } from '@/lib/themes';

const css = readFileSync(join(process.cwd(), 'src/styles/tokens.css'), 'utf8');
const base = css.match(/:root\s*\{([^}]+)\}/)?.[1] ?? '';

function token(block: string, name: string): string | undefined {
  return block.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`))?.[1];
}

function luminance(hex: string) {
  const channels = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255);
  const [red, green, blue] = channels.map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrast(first: string, second: string) {
  const [lighter, darker] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

describe('theme text contrast', () => {
  it('keeps module rail and primary-action labels readable in every theme', () => {
    for (const theme of THEMES) {
      const override = css.match(new RegExp(`:root\\[data-theme="${theme.id}"\\]\\s*\\{([^}]+)\\}`))?.[1] ?? '';
      const value = (name: string) => token(override, name) ?? token(base, name);
      for (const [ink, surface] of [['rail-ink', 'rail-bg'], ['rail-active-ink', 'rail-active-bg'], ['on-accent', 'accent'], ['on-accent', 'accent-hover']]) {
        const foreground = value(ink), background = value(surface);
        expect(foreground && background, `${theme.name}: ${ink} on ${surface} should have tokens`).toBeTruthy();
        expect(contrast(foreground!, background!), `${theme.name}: ${ink} on ${surface}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
  it('keeps small secondary text at WCAG AA contrast on every shared surface', () => {
    for (const theme of THEMES) {
      const override = css.match(new RegExp(`:root\\[data-theme="${theme.id}"\\]\\s*\\{([^}]+)\\}`))?.[1] ?? '';
      const value = (name: string) => token(override, name) ?? token(base, name);
      for (const ink of ['ink-soft', 'ink-faint']) {
        for (const surface of ['canvas', 'surface', 'surface-muted', 'surface-raised']) {
          const foreground = value(ink);
          const background = value(surface);
          expect(foreground && background, `${theme.name}: ${ink} on ${surface} should have color tokens`).toBeTruthy();
          expect(contrast(foreground!, background!), `${theme.name}: ${ink} on ${surface}`).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });
});
