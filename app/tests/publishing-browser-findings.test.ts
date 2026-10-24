// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams('status=scheduled'), notFound: () => { throw new Error('NEXT_NOT_FOUND'); } }));

import { SavedViews } from '@/modules/publishing/ui/SavedViews';
import { PublishingActionCopyProvider } from '@/modules/publishing/ui/WorkflowSubmitButtons';
import { publishingActionCopy } from '@/modules/publishing/action-catalog';

let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
const flush = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });

async function saveWith(post: { status: number; body: unknown }, locale: 'en' | 'fr') {
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => init?.method === 'POST'
    ? { ok: false, status: post.status, json: async () => post.body }
    : { ok: true, status: 200, json: async () => ({ views: [] }) }));
  await act(async () => { root.render(createElement(PublishingActionCopyProvider, { catalog: publishingActionCopy, locale, children: createElement(SavedViews, { screen: 'posts' }) } as never)); });
  await flush();
  const input = container.querySelector<HTMLInputElement>('input')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Mine');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => { container.querySelector('form')!.requestSubmit(); });
  await flush();
  return container.querySelector('[role="alert"]')?.textContent ?? '';
}

describe('saved view save after the session ends', () => {
  it('says the session ended (English) instead of blaming the name', async () => {
    const text = await saveWith({ status: 401, body: { code: 'unauthorized' } }, 'en');
    expect(text).toBe(publishingActionCopy.saved_sessionEnded.en);
    expect(text).not.toContain('Check its name');
  });
  it('says the session ended (French)', async () => {
    expect(await saveWith({ status: 401, body: {} }, 'fr')).toBe(publishingActionCopy.saved_sessionEnded.fr);
  });
  it('keeps the generic failure for other errors and the limit message for conflicts', async () => {
    expect(await saveWith({ status: 400, body: { code: 'invalid_request' } }, 'en')).toBe(publishingActionCopy.saved_saveFailed.en);
    await act(async () => root.unmount()); root = createRoot(container);
    expect(await saveWith({ status: 409, body: { code: 'conflict' } }, 'en')).toBe(publishingActionCopy.saved_limit.en);
  });
});

describe('calendar published-post cue', () => {
  const css = readFileSync('src/modules/publishing/ui/calendar/calendar.module.css', 'utf8');
  it('never dims interactive post content with opacity', () => {
    expect(css).not.toMatch(/\.post[^{]*\{[^}]*opacity\s*:/);
  });
  it('marks published posts with a non-opacity cue', () => {
    expect(css).toMatch(/\.post\[data-status="published"\]\s*\{[^}]*border-left-style:\s*dashed/);
  });
});

describe('unknown post ids', () => {
  it('collaboration post page turns a missing post into a real 404', () => {
    const source = readFileSync('src/modules/publishing/ui/collaboration/post/postId/PostDetailScreen.tsx', 'utf8');
    expect(source).toContain("from 'next/navigation'");
    expect(source).toMatch(/error\.code === 'not_found'\) notFound\(\)/);
  });
});
