// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('../src/modules/inbox/ui/inbox.module.css', () => ({ default: {} }));
vi.mock('../src/components', async () => ({ ...await import('../src/components/Button'), ...await import('../src/components/Dialog') }));
import { ThreadToolbar } from '../src/modules/inbox/ui/InboxActions';

let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
const response = (body: unknown, ok = true) => ({ ok, json: async () => body });
const receipt = (state: string, overrides: Record<string, unknown> = {}) => ({
  ok: true, operationId: 'operation-1', itemId: 'comment-a', state,
  remoteConfirmed: state === 'remote_confirmed' || state === 'completed',
  localConfirmed: state === 'completed', ...overrides,
});

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); this.tabIndex = -1; };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(createElement(ThreadToolbar, { id: 'comment-a', kind: 'comment', resolved: false, hidden: false, canResolve: true, canHide: true, canDelete: true, platformName: 'Example platform', listHref: '/inbox' })));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

async function openDialog(initial: unknown = null) {
  const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    if (init?.method === 'POST') return response(initial);
    return response({ operation: initial });
  });
  vi.stubGlobal('fetch', fetchMock);
  await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent === 'Delete comment')!.click());
  return fetchMock;
}

async function clickDialogButton(label: string) {
  await act(async () => [...container.querySelectorAll<HTMLButtonElement>('dialog button')].find(button => button.textContent === label)!.click());
}

describe('Inbox deletion journal UI', () => {
  it('sends exact delete intent and navigates only after completed local and remote confirmation', async () => {
    const fetchMock = await openDialog(null);
    fetchMock.mockResolvedValueOnce(response(receipt('completed')));
    await clickDialogButton('Delete comment');
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/inbox/deletions?itemId=comment-a', { cache: 'no-store' });
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/inbox/actions', expect.objectContaining({ method: 'POST', body: JSON.stringify({ action: 'delete', id: 'comment-a', confirmation: 'DELETE COMMENT comment-a' }) }));
    expect(router.replace).toHaveBeenCalledWith('/inbox');
    expect(container.querySelector('dialog')?.open).toBeFalsy();
  });

  it('keeps a started operation in the dialog and offers status checks without another delete', async () => {
    const fetchMock = await openDialog(receipt('started'));
    expect(container.textContent).toContain('platform outcome is unconfirmed');
    expect(container.querySelector('dialog')?.textContent).not.toContain('Delete comment');
    expect(container.querySelector('dialog')?.textContent).not.toContain('Keep comment');
    expect([...container.querySelectorAll('dialog button')].some(button => button.textContent === 'Close')).toBe(true);
    fetchMock.mockResolvedValueOnce(response({ operation: receipt('uncertain') }));
    await clickDialogButton('Check deletion status');
    expect(container.textContent).toContain('platform outcome is unconfirmed');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('does not claim success for malformed receipts or a lost delete response', async () => {
    const fetchMock = await openDialog(null);
    fetchMock.mockRejectedValueOnce(new TypeError('private transport detail'));
    await clickDialogButton('Delete comment');
    expect(container.querySelector('dialog')?.open).toBe(true);
    expect(container.textContent).not.toContain('Comment deleted.');
    expect(router.replace).not.toHaveBeenCalled();
    fetchMock.mockResolvedValueOnce(response({ operation: receipt('uncertain') }));
    await clickDialogButton('Check deletion status');
    expect(container.textContent).toContain('platform outcome is unconfirmed');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('requires every completion field before saying deleted or navigating', async () => {
    const fetchMock = await openDialog(null);
    fetchMock.mockResolvedValueOnce(response({ ...receipt('completed'), localConfirmed: false }));
    await clickDialogButton('Delete comment');
    expect(container.querySelector('dialog')?.open).toBe(true);
    expect(container.textContent).not.toContain('Comment deleted.');
    expect(router.replace).not.toHaveBeenCalled();
    expect(container.querySelector('dialog [role=alert]')?.textContent).toBe('Deletion is not fully confirmed. Check status or contact your administrator.');
  });

  it('finishes a known operation even when its canonical local item differs from the displayed alias', async () => {
    const fetchMock = await openDialog(receipt('remote_confirmed'));
    fetchMock.mockResolvedValueOnce(response(receipt('completed', { itemId: 'canonical-comment' })));
    await clickDialogButton('Finish removal from Inbox');
    expect(router.replace).toHaveBeenCalledWith('/inbox');
  });

  it('discovers a remote-confirmed operation on dialog reopen and finalizes locally only', async () => {
    const fetchMock = await openDialog(receipt('remote_confirmed'));
    expect(container.textContent).toContain('The platform confirmed deletion.');
    await clickDialogButton('Close');
    await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent === 'Delete comment')!.click());
    expect(fetchMock).toHaveBeenCalledTimes(2);
    fetchMock.mockResolvedValueOnce(response(receipt('completed')));
    await clickDialogButton('Finish removal from Inbox');
    expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/inbox/actions', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ action: 'finish_delete', operationId: 'operation-1', confirmation: 'FINISH DELETION operation-1' }),
    }));
    expect(router.replace).toHaveBeenCalledWith('/inbox');
  });

  it('preserves the dialog and offers recovery after a failed finalizer', async () => {
    const fetchMock = await openDialog(receipt('remote_confirmed'));
    fetchMock.mockResolvedValueOnce(response({ error: 'Local cleanup is unavailable.', code: 'upstream_failure' }, false));
    await clickDialogButton('Finish removal from Inbox');
    expect(container.querySelector('dialog')?.open).toBe(true);
    expect(container.querySelector('dialog [role=alert]')?.textContent).toBe('Local cleanup is unavailable.');
    expect(container.querySelector<HTMLButtonElement>('dialog button')?.disabled).toBe(false);
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('does not repeat a rejected deletion and focuses the safe cancel action on open', async () => {
    await openDialog(receipt('rejected'));
    expect(container.textContent).toContain('platform rejected this deletion');
    expect(container.querySelector('dialog')?.textContent).not.toContain('Delete comment');
    expect(document.activeElement?.matches('[data-dialog-cancel]')).toBe(true);
    expect(router.replace).not.toHaveBeenCalled();
  });
});
