// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const deps = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: deps.refresh }) }));
import { RootInboxDeletionControls } from '../src/modules/root/ui/RootInboxDeletionControls';

let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
const row = { operationId: 'op-1', workspaceId: 'ws-1', workspaceName: 'Example workspace', targetId: 'target-1', targetName: 'Example channel', provider: 'facebook', remoteObjectId: 'remote-1', localItemId: 'comment-1', state: 'uncertain', createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-02T00:00:00.000Z', remoteConfirmedAt: null, completedAt: null };

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); this.tabIndex = -1; };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(createElement(RootInboxDeletionControls, { row })));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

async function fillConfirmation(phrase: string) {
  const input = container.querySelector<HTMLInputElement>('input[name=confirmation]')!;
  const checkbox = container.querySelector<HTMLInputElement>('input[name=verifiedOnPlatform]')!;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => { setter.call(input, phrase); input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); checkbox.click(); });
}

describe('Root Inbox deletion recovery controls', () => {
  it('requires typed confirmation and platform-verification checkbox before enabling the operator action', async () => {
    await act(async () => container.querySelector<HTMLButtonElement>('button')!.click());
    const submit = [...container.querySelectorAll<HTMLButtonElement>('dialog button')].find(button => button.type === 'submit')!;
    expect(submit.disabled).toBe(true);
    expect(container.textContent).toContain('This is an operator attestation, not an automatic provider check.');
    await fillConfirmation('CONFIRM REMOTE DELETION wrong');
    expect(submit.disabled).toBe(true);
  });

  it('records the explicit attestation, refreshes, and never claims provider verification automatically', async () => {
    const fetchMock = vi.fn(async () => Response.json({ ok: true, operationId: 'op-1', workspaceId: 'ws-1', targetId: 'target-1', localItemId: 'comment-1', state: 'remote_confirmed' }));
    vi.stubGlobal('fetch', fetchMock);
    await act(async () => container.querySelector<HTMLButtonElement>('button')!.click());
    await fillConfirmation('CONFIRM REMOTE DELETION op-1');
    const submit = [...container.querySelectorAll<HTMLButtonElement>('dialog button')].find(button => button.type === 'submit')!;
    expect(submit.disabled).toBe(false);
    await act(async () => submit.click());
    expect(fetchMock).toHaveBeenCalledWith('/api/root/inbox-deletions', expect.objectContaining({ method: 'POST', body: JSON.stringify({ operationId: 'op-1', confirmation: 'CONFIRM REMOTE DELETION op-1', verifiedOnPlatform: true }) }));
    expect(deps.refresh).toHaveBeenCalledOnce();
    expect(container.querySelector('[role=status]')?.textContent).toContain('Remote deletion marked as confirmed.');
  });

  it('retains failed confirmation and dialog context', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'Current Root access is required.' }, { status: 403 })));
    await act(async () => container.querySelector<HTMLButtonElement>('button')!.click());
    await fillConfirmation('CONFIRM REMOTE DELETION op-1');
    await act(async () => [...container.querySelectorAll<HTMLButtonElement>('dialog button')].find(button => button.type === 'submit')!.click());
    expect(container.querySelector('dialog')?.open).toBe(true);
    expect(container.querySelector<HTMLInputElement>('input[name=confirmation]')?.value).toBe('CONFIRM REMOTE DELETION op-1');
    expect(container.querySelector('dialog [role=alert]')?.textContent).toBe('Current Root access is required.');
    expect(deps.refresh).not.toHaveBeenCalled();
  });
});


it('uses the service-supplied confirmation ceiling in the dialog', async () => {
  await act(async () => root.render(createElement(RootInboxDeletionControls, { row, limits: { identifierMaxCharacters: 80, confirmationMaxCharacters: 77 } })));
  await act(async () => container.querySelector<HTMLButtonElement>('button')!.click());
  expect(container.querySelector<HTMLInputElement>('input[name=confirmation]')!.maxLength).toBe(77);
});
