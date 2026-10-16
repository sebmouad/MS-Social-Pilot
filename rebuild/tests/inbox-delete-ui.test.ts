// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('../src/app/inbox/inbox.module.css', () => ({ default: {} }));
vi.mock('../src/components', async () => ({ ...await import('../src/components/Button'), ...await import('../src/components/Dialog') }));
import { ThreadToolbar } from '../src/app/inbox/InboxActions';

let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
let finish: (response: { ok: boolean; json: () => Promise<unknown> }) => void;
beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); this.tabIndex = -1; };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  vi.stubGlobal('fetch', vi.fn((_url: string | URL | Request, init?: RequestInit) => init?.method === 'POST'
    ? new Promise(resolve => { finish = resolve; })
    : Promise.resolve({ ok: true, json: async () => ({ operation: null }) })));
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(createElement(ThreadToolbar, { id: 'example-comment', kind: 'comment', resolved: false, hidden: false, canResolve: true, canHide: true, canDelete: true, platformName: 'Example platform', listHref: '/inbox' })));
  await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent === 'Delete comment')!.click());
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

async function startDeletion() {
  const button = [...container.querySelectorAll('dialog button')].find(button => button.textContent === 'Delete comment')!;
  await act(async () => (button as HTMLButtonElement).click());
}

describe('Inbox deletion recovery', () => {
  it('marks its dialog busy and disables closing while the delete request is pending', async () => {
    await startDeletion();
    const dialog = container.querySelector('dialog')!;
    expect(dialog.getAttribute('aria-busy')).toBe('true');
    expect(dialog.querySelector<HTMLButtonElement>('[aria-label="Close dialog"]')!.disabled).toBe(true);
    await act(async () => dialog.dispatchEvent(new Event('cancel', { cancelable: true })));
    expect(dialog.open).toBe(true);
  });

  it('keeps the failed deletion and its error in the open dialog', async () => {
    await startDeletion();
    await act(async () => finish({ ok: false, json: async () => ({ error: 'Example platform could not remove the comment.', code: 'upstream_failure' }) }));
    const dialog = container.querySelector('dialog');
    expect(dialog?.open).toBe(true);
    expect(dialog?.querySelector('[role=alert]')?.textContent).toBe('Example platform could not remove the comment.');
    expect(dialog?.contains(document.activeElement)).toBe(true);
    expect(router.replace).not.toHaveBeenCalled();
  });
});
