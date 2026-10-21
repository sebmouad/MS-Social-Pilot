import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync('src/styles/components.css', 'utf8');
const layer = css.slice(css.indexOf('Design pass 2026-10-21 (round 4)'));

describe('design pass round 4 (shared stylesheet)', () => {
  it('keeps the layer after the component rules and uses tokens, not raw palette colors', () => {
    expect(layer.length).toBeGreaterThan(1000);
    expect(layer).not.toMatch(/#(?!fff\b)[0-9a-f]{3,8}\b/i);
  });
  it('shares one soft card lift with a dark-mode and system-mode variant', () => {
    expect(layer).toContain('--card-lift:');
    expect(layer).toContain(':root[data-mode="dark"] { --card-lift');
    expect(layer).toMatch(/prefers-color-scheme: dark\) \{ :root\[data-mode="system"\] \{ --card-lift/);
  });
  it('gives the page-header chip the module color and uses no gradients', () => {
    expect(layer).toMatch(/\.ui-page-header__chip \{[^}]*background: var\(--mod/);
    expect(layer).not.toContain('gradient');
  });
  it('lets only the Inbox list scroll when a bulk bar is present', () => {
    expect(layer).toMatch(/section\[class\*="_listPane__"\] \{ display: flex; flex-direction: column; grid-template-rows: none/);
  });
  it('replaces dashed empty states with a filled surface', () => {
    expect(layer).toMatch(/\.ui-state \{[^}]*border: 1px solid var\(--line-subtle\)/);
  });
});
