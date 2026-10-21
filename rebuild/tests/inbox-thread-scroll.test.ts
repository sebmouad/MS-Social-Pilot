// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ThreadScroll } from '../src/modules/inbox/ui/ThreadScroll';

let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

const view = (resetKey: string, text: string) => createElement(ThreadScroll, { label: 'History', resetKey, children: createElement('p', null, text) });

describe('inbox message history scrolling', () => {
  it('renders a keyboard-focusable, labelled region and opens on the newest entry', async () => {
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get: () => 900 });
    await act(async () => root.render(view('message:1', 'hello')));
    const region = container.querySelector<HTMLElement>('[role="region"]')!;
    expect(region.getAttribute('aria-label')).toBe('History');
    expect(region.tabIndex).toBe(0);
    expect(region.scrollTop).toBe(900);
    region.scrollTop = 10;
    await act(async () => root.render(view('message:1', 'hello again')));
    expect(region.scrollTop).toBe(10);
    await act(async () => root.render(view('message:2', 'other')));
    expect(region.scrollTop).toBe(900);
  });

  it('bounds the desktop layout so the list and the history scroll inside their panes', () => {
    const css = readFileSync('src/modules/inbox/ui/inbox.module.css', 'utf8');
    expect(css).toMatch(/\.split \{[^}]*height: max\(480px, calc\(100dvh - var\(--inbox-top-offset, 220px\)\)\)/);
    expect(css).toMatch(/\.listPane \{[^}]*grid-template-rows: auto minmax\(0, 1fr\)/);
    expect(css).toMatch(/\.threadPane \{[^}]*flex-direction: column[^}]*overflow: hidden/);
    expect(css).toMatch(/\.threadScroll \{[^}]*overflow-y: auto/);
    expect(css).toMatch(/@media \(max-width: 900px\)[\s\S]*\.split \{ height: auto; \}/);
  });
});
