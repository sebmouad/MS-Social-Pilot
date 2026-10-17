// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
import { RootPublicationControls } from '../src/server/root/RootPublicationControls';
let root: ReturnType<typeof createRoot>; let container: HTMLDivElement;
const row = { operationId: 'op-1', state: 'uncertain', remotePostId: null, remoteUrl: null, workspaceId: 'workspace-1', workspaceName: 'Example workspace', targetId: 'target-1', targetName: 'Example channel', postId: 'post-1' };
async function click(text: string) { const button = Array.from((container.querySelector('dialog') ?? container).querySelectorAll('button')).find(button => button.textContent === text); expect(button).toBeTruthy(); await act(async () => { button!.focus(); button!.click(); }); }
async function prepare() {
  await click('Record external check');
  await act(async () => container.querySelector<HTMLInputElement>('input[value="ABSENT"]')!.click());
  const field = container.querySelector<HTMLInputElement>('[name="confirmation"]')!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, 'ROOT RECORD PUBLICATION op-1 ABSENT'); field.dispatchEvent(new Event('input', { bubbles: true })); });
  await act(async () => container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
}
beforeEach(async () => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); this.tabIndex = -1; };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  router.refresh.mockClear(); container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ok: true, operationId: 'op-1', state: 'attested_absent' })));
  await act(async () => root.render(createElement(RootPublicationControls, { row })));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
describe('Root publication recovery controls', () => {
  it('requires explicit verification and confirms the exact operation with resolved workspace/channel context', async () => {
    await prepare(); expect(container.textContent).toContain('Example workspace'); expect(container.textContent).toContain('Example channel');
    await click('Record external check');
    expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string)).toEqual({ operationId: 'op-1', outcome: 'ABSENT', verifiedExternally: true, confirmation: 'ROOT RECORD PUBLICATION op-1 ABSENT' });
    expect(router.refresh).toHaveBeenCalledOnce(); expect(container.querySelector('dialog')).toBeNull(); expect(document.activeElement?.getAttribute('role')).toBe('status');
    await act(async () => root.render(createElement(RootPublicationControls, { row: { ...row, state: 'attested_absent' } })));
    expect(container.textContent).toContain('Human-verified absence recorded'); expect(document.activeElement?.getAttribute('role')).toBe('status');
  });
  it('preserves confirmation and focuses an error after a mismatched success receipt', async () => {
    await prepare(); vi.mocked(fetch).mockResolvedValueOnce(Response.json({ ok: true, operationId: 'other', state: 'attested_absent' }));
    await click('Record external check'); expect(container.querySelector('dialog')).toBeTruthy();
    expect(container.querySelector<HTMLInputElement>('[name="confirmation"]')!.value).toBe('ROOT RECORD PUBLICATION op-1 ABSENT');
    expect(document.activeElement?.getAttribute('role')).toBe('alert'); expect(router.refresh).not.toHaveBeenCalled();
  });
  it('cancel restores focus to the recovery opener', async () => {
    await click('Record external check'); await click('Cancel'); expect(container.querySelector('dialog')).toBeNull(); expect(document.activeElement?.textContent).toBe('Record external check');
  });
});
