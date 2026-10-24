import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_THEME, THEMES } from '@/lib/themes';

const read = (file: string) => readFileSync(join(process.cwd(), 'src', file), 'utf8');
const tokens = read('styles/tokens.css');
const components = read('styles/components.css');
const responsive = read('styles/responsive.css');
const shared = [tokens, components, responsive];

const AREAS = ['home', 'content', 'inbox', 'insights', 'tasks', 'agency', 'settings', 'root'] as const;
const MODS: Record<(typeof AREAS)[number], string> = { home: 'home', content: 'publishing', inbox: 'inbox', insights: 'analytics', tasks: 'tasks', agency: 'agency', settings: 'settings', root: 'root' };

type Block = { theme: string; mode: 'light' | 'dark'; body: string };
function palettes(): Block[] {
  const blocks: Block[] = [];
  const re = /:root\[data-theme="(\w+)"\](?:\[data-mode="(\w+)"\])?\s*\{([^}]+)\}/g;
  for (const m of tokens.matchAll(re)) if (m[2] !== 'system') blocks.push({ theme: m[1], mode: m[2] === 'dark' ? 'dark' : 'light', body: m[3] });
  return blocks;
}
const raw = (body: string, name: string) => body.match(new RegExp(`--${name}:\\s*([^;]+);`))?.[1].trim();
const base = tokens.match(/:root\s*\{([^}]+)\}/)![1];

function resolve(block: Block, name: string, depth = 0): string | undefined {
  const value = raw(block.body, name) ?? raw(base, name);
  if (!value || depth > 6) return value;
  const ref = value.match(/^var\(--([\w-]+)\)$/);
  return ref ? resolve(block, ref[1], depth + 1) : value;
}
const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };

describe('design tokens v2', () => {
  it('has the eight palettes and Clean as the default theme', () => {
    expect(palettes()).toHaveLength(THEMES.length * 2);
    expect(DEFAULT_THEME).toBe('clean');
  });

  it('keeps the eight area colours pairwise distinct with a readable icon in every palette', () => {
    for (const block of palettes()) {
      const colours = AREAS.map(area => resolve(block, `area-${area}`) ?? resolve(block, `mod-${MODS[area]}`));
      for (const c of colours) expect(c, `${block.theme} ${block.mode}: area colour`).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(new Set(colours.map(c => c!.toLowerCase())).size, `${block.theme} ${block.mode}: area colours are distinct`).toBe(AREAS.length);
      const onMod = block.mode === 'dark' ? resolve(block, 'canvas')! : resolve(block, 'on-mod')!;
      expect(raw(block.body, 'on-mod'), `${block.theme} ${block.mode}: --on-mod`).toBe(block.mode === 'dark' ? 'var(--canvas)' : '#ffffff');
      for (const c of colours) expect(contrast(onMod, c!), `${block.theme} ${block.mode}: --on-mod on ${c}`).toBeGreaterThanOrEqual(3);
    }
  });

  it('keeps every chart slot at 3:1 on the surface in every palette', () => {
    for (const block of palettes()) {
      const surface = resolve(block, 'surface')!;
      for (let i = 1; i <= 8; i++) expect(contrast(resolve(block, `chart-${i}`)!, surface), `${block.theme} ${block.mode}: chart-${i}`).toBeGreaterThanOrEqual(3);
    }
  });

  it('defines success tokens per palette that stay readable', () => {
    for (const block of palettes()) {
      expect(contrast(resolve(block, 'success')!, resolve(block, 'success-soft')!), `${block.theme} ${block.mode}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('draws field and control borders with --control-border, never --line-strong', () => {
    const fieldSelectors = ['.ui-input', '.ui-select__trigger', '.ui-menu__trigger', '.ui-segmented', '.ui-filter-chip', '.ui-filter select'];
    const rules = [...(components + tokens).matchAll(/^([^{}\n@/][^{}]*)\{([^}]*)\}/gm)];
    for (const [, selector, body] of rules) {
      const names = selector.split(',').map(s => s.trim());
      if (!names.some(n => fieldSelectors.some(f => n === f || n.startsWith(`${f}:`) || n.startsWith(`${f}[`)))) continue;
      expect(body, `${selector.trim()} must not use --line-strong`).not.toMatch(/border(-color)?:[^;]*--line-strong/);
    }
  });

  it('has no mode-dependent component rules outside palette blocks', () => {
    for (const css of shared) {
      for (const m of css.matchAll(/^[^\n{]*data-mode="(?:dark|system)"\][^\n{]*\{/gm)) {
        const selector = m[0];
        expect(selector, 'only :root token blocks may depend on the mode').toMatch(/^(@media[^{]*\{\s*)?:root(\[data-theme="\w+"\])?\[data-mode="(dark|system)"\]\s*\{$/);
      }
    }
  });

  it('removed the round-4 override layer and its hashed-class selectors', () => {
    expect(components).not.toMatch(/round 4/i);
    for (const css of shared) {
      expect(css).not.toMatch(/\[class\*=["']_/);
    }
    expect(components).not.toMatch(/!important[^;]*;[^\n]*\n[^\n]*_card__/);
  });

  it('uses at most nine raw font sizes in shared CSS and tokens for the rest', () => {
    const sizes = new Set<string>();
    for (const css of shared) for (const m of css.matchAll(/font-size:\s*([0-9.]+(?:px|rem|em))/g)) sizes.add(m[1]);
    expect(sizes.size).toBeLessThanOrEqual(9);
    for (const token of ['2xs', 'xs', 'sm', 'md', 'lg', 'xl', '2xl', '3xl', 'metric']) expect(base).toContain(`--text-${token}:`);
  });

  it('defines the shape, elevation and motion tokens', () => {
    for (const token of ['radius-xs', 'radius-sm', 'radius-md', 'radius-lg', 'radius-full', 'shadow-card', 'shadow-pop', 'shadow-sheet', 'ease-fast', 'ease', 'ease-sheet', 'control-h-sm', 'control-h', 'control-h-touch', 'row-h', 'row-h-compact', 'sidebar-w', 'sidebar-w-rail', 'topbar-h', 'bottombar-h', 'content-max', 'form-max', 'gutter']) {
      expect(base, `--${token}`).toContain(`--${token}:`);
    }
  });
});
