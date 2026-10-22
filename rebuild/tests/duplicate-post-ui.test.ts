// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const deps = vi.hoisted(() => ({
  router: { push: vi.fn(), refresh: vi.fn() },
  randomUUID: vi.fn(() => 'request-copy-1'),
}));
vi.mock('next/navigation', () => ({ useRouter: () => deps.router }));
vi.mock('../src/modules/publishing/ui/publishing.module.css', () => ({ default: { help: 'help', formError: 'formError' } }));

import { DuplicatePost } from '../src/modules/publishing/ui/posts/DuplicatePost';

let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
const finishes: Array<(response: { ok: boolean; json: () => Promise<unknown> }) => void> = [];

function receipt(overrides: Record<string, unknown> = {}) {
  return { sourcePostId: 'source-1', postId: 'request-copy-1', draftCreated: true, replayed: false, ...overrides };
}

async function submit() {
  await act(async () => container.querySelector<HTMLButtonElement>('button')!.click());
}

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  finishes.length = 0;
  vi.stubGlobal('crypto', { randomUUID: deps.randomUUID });
  vi.stubGlobal('fetch', vi.fn(() => new Promise(resolve => { finishes.push(resolve); })));
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(createElement(DuplicatePost, { postId: 'source-1' })));
});

afterEach(async () => {
  await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals();
});

describe('DuplicatePost', () => {
  it('describes a new unscheduled copy and blocks repeat submits while pending', async () => {
    expect(container.textContent).toContain('new unscheduled draft');
    expect(container.textContent).toContain('content, first comment, media, and currently selected destinations');
    expect(deps.randomUUID).not.toHaveBeenCalled();
    await submit();
    expect(deps.randomUUID).toHaveBeenCalledTimes(1);
    expect(container.querySelector('button')?.disabled).toBe(true);
    await submit();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('keeps the request ID after a failed request so retry cannot create another draft', async () => {
    await submit();
    await act(async () => finishes[0]({ ok: false, json: async () => ({ error: 'unsafe server detail' }) }));
    expect(container.querySelector('[role=alert]')?.textContent).toContain('The copy result could not be confirmed. Check Drafts before trying again.');
    expect(container.querySelector('[role=alert] a')?.getAttribute('href')).toBe('/content?status=draft');
    expect(container.querySelector('[role=alert] a')?.getAttribute('target')).toBe('_blank');
    expect(container.contains(document.activeElement)).toBe(true);
    await submit();
    const bodies = vi.mocked(fetch).mock.calls.map(call => JSON.parse(String(call[1]?.body)));
    expect(bodies.map(body => body.requestId)).toEqual(['request-copy-1', 'request-copy-1']);
    expect(deps.randomUUID).toHaveBeenCalledTimes(1);
  });

  it('focuses network failure feedback and reuses the original request ID on retry', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError('private network details'));
    await submit();
    await act(async () => Promise.resolve());
    expect(container.querySelector('[role=alert]')?.textContent).toContain('The copy result could not be confirmed. Check Drafts before trying again.');
    expect(container.querySelector('[role=alert]')).toBe(document.activeElement);
    expect(container.textContent).not.toContain('private network details');

    await submit();
    const bodies = vi.mocked(fetch).mock.calls.map(call => JSON.parse(String(call[1]?.body)));
    expect(bodies.map(body => body.requestId)).toEqual(['request-copy-1', 'request-copy-1']);
    await act(async () => finishes[0]({ ok: true, json: async () => receipt() }));
  });

  it('shows safe typed denials and masks upstream failures', async () => {
    await submit();
    await act(async () => finishes[0]({ ok: false, json: async () => ({ code: 'forbidden', error: 'You do not have permission to duplicate posts.' }) }));
    expect(container.querySelector('[role=alert]')?.textContent).toContain('You do not have permission to duplicate posts.');

    await submit();
    await act(async () => finishes[1]({ ok: false, json: async () => ({ code: 'upstream_failure', error: 'Provider token and stack trace' }) }));
    expect(container.querySelector('[role=alert]')?.textContent).toContain('The copy result could not be confirmed. Check Drafts before trying again.');
    expect(container.textContent).not.toMatch(/Provider token|stack trace/);

    await submit();
    await act(async () => finishes[2]({ ok: false, json: async () => { throw new Error('502 provider token and stack trace'); } }));
    expect(container.querySelector('[role=alert]')?.textContent).toContain('The copy result could not be confirmed. Check Drafts before trying again.');
    expect(container.textContent).not.toMatch(/502 provider token|stack trace/);
  });

  it('refocuses recovery feedback after an identical repeated failure', async () => {
    await submit();
    await act(async () => finishes[0]({ ok: false, json: async () => ({ code: 'forbidden', error: 'You do not have permission to duplicate posts.' }) }));
    expect(container.querySelector('[role=alert]')).toBe(document.activeElement);

    await submit();
    container.querySelector('button')?.focus();
    await act(async () => finishes[1]({ ok: false, json: async () => ({ code: 'forbidden', error: 'You do not have permission to duplicate posts.' }) }));
    expect(container.querySelector('[role=alert]')).toBe(document.activeElement);
  });

  it.each([
    ['wrong source', { sourcePostId: 'other-source' }],
    ['wrong post identity', { postId: 'other-copy' }],
    ['missing draft confirmation', { draftCreated: false }],
  ])('does not navigate for a receipt with %s', async (_label, overrides) => {
    await submit();
    await act(async () => finishes[0]({ ok: true, json: async () => receipt(overrides) }));
    expect(container.querySelector('[role=alert]')).toBeTruthy();
    expect(deps.router.push).not.toHaveBeenCalled();
  });

  it('navigates and refreshes only after validating the duplicate receipt', async () => {
    await submit();
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe('/api/publishing/duplicate');
    expect(JSON.parse(String(init?.body))).toEqual({ postId: 'source-1', requestId: 'request-copy-1', confirmation: 'DUPLICATE POST source-1' });
    await act(async () => finishes[0]({ ok: true, json: async () => receipt() }));
    expect(deps.router.push).toHaveBeenCalledWith('/content?status=draft&notice=duplicated');
    expect(deps.router.refresh).toHaveBeenCalledTimes(1);
  });

  it('mints a fresh request ID for a later deliberate duplicate after confirmed success', async () => {
    deps.randomUUID.mockReturnValueOnce('request-copy-1').mockReturnValueOnce('request-copy-2');
    await submit();
    await act(async () => finishes[0]({ ok: true, json: async () => receipt() }));

    await submit();
    await act(async () => finishes[1]({ ok: true, json: async () => receipt({ postId: 'request-copy-2' }) }));

    const bodies = vi.mocked(fetch).mock.calls.map(call => JSON.parse(String(call[1]?.body)));
    expect(bodies.map(body => body.requestId)).toEqual(['request-copy-1', 'request-copy-2']);
    expect(deps.router.push).toHaveBeenCalledTimes(2);
    expect(deps.router.refresh).toHaveBeenCalledTimes(2);
  });
});
