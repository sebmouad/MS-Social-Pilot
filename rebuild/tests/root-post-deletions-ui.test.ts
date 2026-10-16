// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const deps = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: deps.refresh }) }));
import { RootPostDeletionControls } from '../src/server/root/RootPostDeletionControls';

let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
const row = { operationId: 'op-1', workspaceId: 'ws-1', workspaceName: 'Example workspace', targetId: 'target-1', targetName: 'Example channel', provider: 'facebook', remotePostId: 'remote-1', localPostIds: ['post-1'], state: 'uncertain' };

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); this.tabIndex = -1; };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(createElement(RootPostDeletionControls, { row })));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

async function chooseOutcome(outcome: 'deleted' | 'not_deleted', phrase: string) {
  const radio = container.querySelector<HTMLInputElement>(`input[name=outcome][value=${outcome}]`)!;
  const input = container.querySelector<HTMLInputElement>('input[name=confirmation]')!;
  const checkbox = container.querySelector<HTMLInputElement>('input[name=verifiedOnPlatform]')!;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    radio.click(); setter.call(input, phrase); input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); checkbox.click();
  });
}

describe('Root Publishing deletion recovery controls', () => {
  it('requires a selected platform outcome, exact phrase, and explicit human verification', async () => {
    await act(async () => container.querySelector<HTMLButtonElement>('button')!.click());
    const submit = container.querySelector<HTMLButtonElement>('dialog button[type=submit]')!;
    expect(submit.disabled).toBe(true);
    expect(container.textContent).toContain('A pending request may still take effect later');
    await chooseOutcome('deleted', 'ROOT RECORD POST DELETION wrong DELETED');
    expect(submit.disabled).toBe(true);
  });

  it('records only the explicit outcome and reports the exact returned state', async () => {
    const fetchMock = vi.fn(async () => Response.json({ ok: true, operationId: 'op-1', state: 'rejected' }));
    vi.stubGlobal('fetch', fetchMock);
    await act(async () => container.querySelector<HTMLButtonElement>('button')!.click());
    await chooseOutcome('not_deleted', 'ROOT RECORD POST DELETION op-1 NOT DELETED');
    await act(async () => container.querySelector<HTMLButtonElement>('dialog button[type=submit]')!.click());
    expect(fetchMock).toHaveBeenCalledWith('/api/root/post-deletions', expect.objectContaining({ method: 'POST', body: JSON.stringify({ operationId: 'op-1', outcome: 'not_deleted', confirmation: 'ROOT RECORD POST DELETION op-1 NOT DELETED', verifiedOnPlatform: true }) }));
    expect(deps.refresh).toHaveBeenCalledOnce();
    expect(container.querySelector('[role=status]')?.textContent).toContain('No new provider request was made.');
    expect(document.activeElement).toBe(container.querySelector('[role=status]'));
  });

  it('retains selected outcome, exact phrase and dialog after server rejection', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'Current Root access is required.' }, { status: 403 })));
    await act(async () => container.querySelector<HTMLButtonElement>('button')!.click());
    await chooseOutcome('deleted', 'ROOT RECORD POST DELETION op-1 DELETED');
    await act(async () => container.querySelector<HTMLButtonElement>('dialog button[type=submit]')!.click());
    expect(container.querySelector('dialog')?.open).toBe(true);
    expect(container.querySelector<HTMLInputElement>('input[name=outcome][value=deleted]')?.checked).toBe(true);
    expect(container.querySelector<HTMLInputElement>('input[name=confirmation]')?.value).toBe('ROOT RECORD POST DELETION op-1 DELETED');
    expect(container.querySelector('dialog [role=alert]')?.textContent).toBe('Current Root access is required.');
    expect(deps.refresh).not.toHaveBeenCalled();
  });
});
