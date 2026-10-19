// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const router = vi.hoisted(() => ({ refresh: vi.fn(), replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
import { PublicationRecovery } from '../src/app/publishing/posts/PublicationRecovery';

let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
const operation = { id: 'op-1', postTargetId: 'pt-1', targetId: 'target-1', targetName: 'Example channel', state: 'uncertain', reason: null, remotePostId: null, remoteUrl: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
const post = { postId: 'post-1', operations: [operation], legacyProcessingCount: 0, truncated: false };
const props = { postId: 'post-1', excerpt: 'A sample post', targets: [{ id: 'pt-1', name: 'Example channel', status: 'processing', remotePostId: null }] };
async function click(text: string) { const button = Array.from(container.querySelectorAll('button')).find(button => button.textContent === text); expect(button).toBeTruthy(); await act(async () => { button!.focus(); button!.click(); }); }
async function value(name: string, text: string) {
  const input = container.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, text); input.dispatchEvent(new Event('input', { bubbles: true })); });
}
async function prepare() {
  await click('Review publication result'); await click('Record external check');
  await act(async () => container.querySelector<HTMLInputElement>('input[value="PUBLISHED"]')!.click());
  await value('remotePostId', 'remote-1'); await value('confirmation', 'RECORD PUBLICATION op-1 PUBLISHED');
  await act(async () => container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
}
beforeEach(async () => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); this.tabIndex = -1; };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  router.refresh.mockClear(); router.replace.mockClear(); window.history.replaceState(null, '', '/publishing/posts?status=publishing&view=cards&page=3'); container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => Response.json(init?.method === 'POST' ? { ...post, operations: [{ ...operation, state: 'receipt_recorded', remotePostId: 'remote-1' }] } : post)));
  await act(async () => root.render(createElement(PublicationRecovery, props)));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

describe('Publication recovery customer surface', () => {
  it('requires an explicit external check and exact operation-bound receipt confirmation', async () => {
    await prepare();
    expect(container.querySelector('dialog')).toBeTruthy(); expect(container.textContent).toContain('A sample post');
    await click('Record checked outcome');
    const call = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === 'POST')!;
    expect(JSON.parse(call[1]!.body as string)).toEqual({ postId: 'post-1', action: 'record', operationId: 'op-1', outcome: 'PUBLISHED', verifiedExternally: true, remotePostId: 'remote-1', confirmation: 'RECORD PUBLICATION op-1 PUBLISHED' });
    expect(router.refresh).toHaveBeenCalledOnce(); expect(container.querySelector('dialog')).toBeNull();
    expect(container.textContent).toContain('Human-verified receipt saved');
  });
  it('retains entered receipt, exact phrase and dialog after an unconfirmed transport result', async () => {
    await prepare(); vi.mocked(fetch).mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await click('Record checked outcome');
    expect(container.querySelector('dialog')).toBeTruthy(); expect(container.querySelector<HTMLInputElement>('[name="remotePostId"]')!.value).toBe('remote-1');
    expect(container.querySelector<HTMLInputElement>('[name="confirmation"]')!.value).toBe('RECORD PUBLICATION op-1 PUBLISHED');
    expect(document.activeElement?.getAttribute('role')).toBe('alert'); expect(container.textContent).not.toContain('Failed to fetch'); expect(container.textContent).toContain('Check current status'); expect(router.refresh).not.toHaveBeenCalled();
  });
  it('refuses a success response for a different post or unresolved operation', async () => {
    await prepare(); vi.mocked(fetch).mockResolvedValueOnce(Response.json({ ...post, postId: 'other-post' }));
    await click('Record checked outcome'); expect(container.querySelector('dialog')).toBeTruthy(); expect(router.refresh).not.toHaveBeenCalled();
  });
  it('omits an earlier published receipt when the explicitly selected result becomes absent', async () => {
    await prepare(); await act(async () => container.querySelector<HTMLInputElement>('input[value="ABSENT"]')!.click());
    await value('confirmation', 'RECORD PUBLICATION op-1 ABSENT');
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ ...post, operations: [{ ...operation, state: 'attested_absent' }] }));
    await click('Record checked outcome');
    const call = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === 'POST')!;
    expect(JSON.parse(call[1]!.body as string)).not.toHaveProperty('remotePostId'); expect(JSON.parse(call[1]!.body as string)).not.toHaveProperty('remoteUrl');
    expect(router.replace).toHaveBeenCalledWith('/publishing/posts?status=publishing&view=cards&page=3&notice=publication-absent&recovery=op-1', { scroll: false });
  });
  it('does not render a recovery action for a resolved destination', async () => {
    await act(async () => root.render(createElement(PublicationRecovery, { ...props, targets: [{ id: 'pt-1', status: 'published', remotePostId: 'remote-1' }] })));
    expect(container.textContent).toBe('');
  });
  it('labels submitted receipts as awaiting verification and restricts attestation to the stored remote ID', async () => {
    const submitted = { ...operation, state: 'submitted', remotePostId: 'provider-final-1' };
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => Response.json(init?.method === 'POST' ? { ...post, operations: [{ ...submitted, state: 'receipt_recorded' }] } : { ...post, operations: [submitted] })));
    await click('Review publication result');
    expect(container.textContent).toContain('Submitted; awaiting verification');
    expect(container.textContent).not.toContain('Finish local record');
    await click('Verify submitted publication');
    expect(container.querySelector<HTMLInputElement>('input[value="ABSENT"]')).toBeNull();
    const id = container.querySelector<HTMLInputElement>('[name="remotePostId"]')!;
    expect(id.value).toBe('provider-final-1'); expect(id.readOnly).toBe(true);
    await value('confirmation', 'RECORD PUBLICATION op-1 PUBLISHED');
    await act(async () => container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    await click('Record checked outcome');
    const call = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === 'POST')!;
    expect(JSON.parse(call[1]!.body as string)).toEqual({ postId: 'post-1', action: 'record', operationId: 'op-1', outcome: 'PUBLISHED', verifiedExternally: true, remotePostId: 'provider-final-1', confirmation: 'RECORD PUBLICATION op-1 PUBLISHED' });
    expect(container.textContent).toContain('Human-verified receipt saved. Finish the local record separately.');
  });
});
