// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import NotFound from '@/app/not-found';
import { ERROR_STATE_COPY } from '@/components/ErrorState';

let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); document.documentElement.lang = 'en'; });

describe('not-found page', () => {
  it('renders the English copy with a link home and no retry button', async () => {
    await act(async () => { root.render(createElement(NotFound)); });
    expect(container.querySelector('h1')!.textContent).toBe(ERROR_STATE_COPY.en.notFoundTitle);
    expect(container.querySelector('p')!.textContent).toBe(ERROR_STATE_COPY.en.notFoundBody);
    expect(container.querySelector('button')).toBeNull();
    const link = container.querySelector('a')!;
    expect(link.getAttribute('href')).toBe('/home');
    expect(link.className).toContain('ui-button');
    expect(container.querySelector('main')!.getAttribute('role')).toBeNull();
  });

  it('renders French when the document language is French', async () => {
    document.documentElement.lang = 'fr';
    await act(async () => { root.render(createElement(NotFound)); });
    expect(container.querySelector('h1')!.textContent).toBe(ERROR_STATE_COPY.fr.notFoundTitle);
    expect(container.querySelector('a')!.textContent).toBe(ERROR_STATE_COPY.fr.home);
  });
});
