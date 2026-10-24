// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
import { RescheduleQueuedPost } from '../src/modules/publishing/ui/queue/RescheduleQueuedPost';
import { NestedReply } from '../src/modules/inbox/ui/NestedReply';
let root: ReturnType<typeof createRoot>; let container: HTMLDivElement;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks(); document.documentElement.lang = 'en';
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
async function render(node: React.ReactNode) { await act(async () => root.render(node)); }
async function change(selector: string, value: string) {
  const field = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value')!.set!.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true })); field.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
async function click(label: string) {
  const button = [...container.querySelectorAll('button')].find(item => item.textContent === label)!;
  expect(button).toBeTruthy(); await act(async () => button.click());
}
const queued = () => createElement(RescheduleQueuedPost, { postId: 'p1', date: '2035-01-02', time: '10:00', timeZone: 'Europe/Paris', text: 'Synthetic post' });
const receipt = { action: 'reschedule', requested: 1, done: 1, failed: 0, skipped: 0, needsReview: 0, items: [{ postId: 'p1', outcome: 'done' }] };
const response = (body: unknown) => ({ ok: true, json: async () => body });

describe('Queue reschedule', () => {
  it('reviews workspace-local time and uses the existing HTTP service', async () => {
    const fetcher = vi.fn(async (_url: string, _init: RequestInit) => response(receipt)); vi.stubGlobal('fetch', fetcher);
    await render(queued()); await change('input[type=time]', '11:30'); await click('Review new time');
    expect(container.querySelector('dialog')?.textContent).toContain('2035-01-02 11:30 (Europe/Paris)'); expect(fetcher).not.toHaveBeenCalled();
    await change('dialog input', 'RESCHEDULE 1 POSTS'); await click('Move post');
    expect(JSON.parse(fetcher.mock.calls[0]![1].body as string)).toMatchObject({ action: 'reschedule', postIds: ['p1'], date: '2035-01-02', time: '11:30', confirmation: 'RESCHEDULE 1 POSTS' });
    expect(container.textContent).toContain('Post rescheduled.'); expect(router.refresh).toHaveBeenCalledOnce();
  });
  it.each([null, { ...receipt, done: 0, skipped: 1 }, { ...receipt, items: [{ postId: 'other', outcome: 'done' }] }])('retains time and confirmation for skipped or unverified receipts', async body => {
    vi.stubGlobal('fetch', vi.fn(async () => response(body))); await render(queued()); await change('input[type=time]', '11:30');
    await click('Review new time'); await change('dialog input', 'RESCHEDULE 1 POSTS'); await click('Move post');
    expect(container.querySelector('dialog [role=alert]')?.textContent).toContain('could not be confirmed');
    expect(container.querySelector<HTMLInputElement>('input[type=time]')?.value).toBe('11:30');
    expect(container.querySelector<HTMLInputElement>('dialog input')?.value).toBe('RESCHEDULE 1 POSTS'); expect(router.refresh).not.toHaveBeenCalled();
  });
  it('rejects a skipped DST time before dispatch', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher); await render(queued());
    await change('input[type=date]', '2035-03-25'); await change('input[type=time]', '02:30'); await click('Review new time');
    expect(container.querySelector('[role=alert]')?.textContent).toContain('valid future time'); expect(fetcher).not.toHaveBeenCalled();
  });
  it('localizes confirmation and cancels without dispatch', async () => {
    document.documentElement.lang = 'fr'; const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher); await render(queued());
    await click('Vérifier le nouvel horaire'); await click('Annuler'); expect(fetcher).not.toHaveBeenCalled(); expect(container.querySelector('dialog')).toBeNull();
  });
});

describe('Nested visitor replies', () => {
  const nested = (canReply = true, allowed = true) => createElement(NestedReply, { id: 'nested-visitor', author: 'Camille', canReply, allowed });
  it('addresses the selected descendant rather than the opening comment', async () => {
    const fetcher = vi.fn(async (_url: string, _init: RequestInit) => response({ ok: true })); vi.stubGlobal('fetch', fetcher); await render(nested());
    expect(container.querySelector('summary')?.textContent).toBe('Reply to Camille'); await change('textarea', 'Thanks'); await click('Send reply');
    expect(JSON.parse(fetcher.mock.calls[0]![1].body as string)).toEqual({ action: 'reply', kind: 'comment', id: 'nested-visitor', text: 'Thanks' });
    expect(container.querySelector('textarea')?.value).toBe(''); expect(router.refresh).toHaveBeenCalledOnce();
  });
  it('retains the draft and masks lost-response details', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('private provider details'); })); await render(nested()); await change('textarea', 'Keep this draft'); await click('Send reply');
    expect(container.querySelector('textarea')?.value).toBe('Keep this draft'); expect(container.textContent).toContain('outcome is unconfirmed'); expect(container.textContent).not.toContain('private provider'); expect(router.refresh).not.toHaveBeenCalled();
  });
  it('omits unauthorized/unsupported actions and enforces policy', async () => {
    await render(nested(false)); expect(container.querySelector('textarea')).toBeNull(); await render(nested(true, false)); expect(container.querySelector('textarea')?.disabled).toBe(true);
  });
  it('provides French public-reply and failure copy', async () => {
    document.documentElement.lang = 'fr'; vi.stubGlobal('fetch', vi.fn(async () => response({ ok: false }))); await render(nested());
    expect(container.textContent).toContain('Répondre à Camille'); expect(container.textContent).toContain('Cette réponse est publique');
    await change('textarea', 'Merci'); await click('Envoyer la réponse'); expect(container.textContent).toContain('Le résultat n’est pas confirmé');
  });
  it('dispatches once when two submit events race', async () => {
    let finish!: (value: unknown) => void; const fetcher = vi.fn(() => new Promise(resolve => { finish = resolve; })); vi.stubGlobal('fetch', fetcher);
    await render(nested()); await change('textarea', 'Thanks'); const form = container.querySelector('form')!;
    await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(fetcher).toHaveBeenCalledOnce(); await act(async () => finish(response({ ok: true })));
  });
});
