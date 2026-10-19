// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

import { InvitationControls } from '../src/modules/settings/ui/team/InvitationControls';

let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
const respond = (body: unknown, ok = true) => ({ ok, json: async () => body });
const future = '2026-10-24T12:00:00.000Z';
type FixtureInvitation = { id: string; email: string; role: string; createdAt: string; expiresAt: string; acceptedAt: string | null; status: 'pending' | 'expired' | 'accepted' };
const pending: FixtureInvitation = { id: 'invite-1', email: 'noura@example.test', role: 'contributor', createdAt: '2026-10-17T12:00:00.000Z', expiresAt: future, acceptedAt: null, status: 'pending' };
const baseProps = { invitations: [] as FixtureInvitation[], actorRole: 'admin', available: true };

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); this.tabIndex = -1; };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

async function render(props: Partial<typeof baseProps> = {}) {
  await act(async () => root.render(createElement(InvitationControls, { ...baseProps, ...props })));
}
function button(label: string, parent: ParentNode = container) {
  const found = Array.from(parent.querySelectorAll('button')).find(item => item.textContent?.trim() === label);
  if (!found) throw new Error(`Missing button: ${label}`);
  return found as HTMLButtonElement;
}
async function click(target: HTMLElement) { await act(async () => target.click()); }
async function enter(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => { setter.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); });
}
async function inviteDialog(email = ' NOURA@EXAMPLE.TEST ') {
  await enter(container.querySelector<HTMLInputElement>('#team-invitation-email')!, email);
  await click(button('Review invitation'));
  return container.querySelector<HTMLDialogElement>('dialog')!;
}
async function confirm(dialog: HTMLDialogElement, label: 'INVITE' | 'REVOKE', phrase: string) {
  await enter(dialog.querySelector<HTMLInputElement>(`[aria-label="${label} confirmation"]`)!, phrase);
}

describe('Invitation controls', () => {
  it('reviews a canonical email, posts the exact confirmation and reports the sent receipt', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respond({ ok: true, id: 'invite-new', delivery: 'sent', expiresAt: future })));
    await render();
    const dialog = await inviteDialog();
    expect(dialog.textContent).toContain('noura@example.test');
    expect(dialog.textContent).toContain('No channels selected');
    expect(dialog.textContent).toContain('INVITE MEMBER noura@example.test');
    await confirm(dialog, 'INVITE', 'INVITE MEMBER noura@example.test');
    await click(button('Create invitation', dialog));
    const [url, init] = vi.mocked(fetch).mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/settings/team/invitations');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ email: 'noura@example.test', role: 'contributor', confirmation: 'INVITE MEMBER noura@example.test' });
    expect(router.refresh).toHaveBeenCalledOnce();
    expect(container.querySelector('dialog')).toBeNull();
    expect(container.querySelector('[role=status]')?.textContent).toContain('The email was sent');
    expect(container.querySelector('[role=status]')?.textContent).toContain('Oct 24, 2026');
  });

  it('keeps a failed email outcome distinct from invitation creation', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respond({ ok: true, id: 'invite-new', delivery: 'failed', expiresAt: future })));
    await render();
    const dialog = await inviteDialog();
    await confirm(dialog, 'INVITE', 'INVITE MEMBER noura@example.test');
    await click(button('Create invitation', dialog));
    expect(container.querySelector('[role=alert]')?.textContent).toMatch(/Invitation recorded.*email was not delivered.*reissue.*invalidates the previous link/i);
    expect(router.refresh).toHaveBeenCalledOnce();
    expect(container.querySelector('dialog')).toBeNull();
  });

  it('treats unknown email delivery as possibly sent and blocks blind reissue guidance', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respond({ ok: true, id: 'invite-new', delivery: 'uncertain', expiresAt: future })));
    await render();
    const dialog = await inviteDialog();
    await confirm(dialog, 'INVITE', 'INVITE MEMBER noura@example.test');
    await click(button('Create invitation', dialog));
    expect(container.querySelector('[role=alert]')?.textContent).toMatch(/may have been sent.*check with the recipient and invitation list before reissuing/i);
  });

  it('lets an admin reissue a pending invite after an explicit link-invalidation review', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respond({ ok: true, id: pending.id, delivery: 'sent', expiresAt: future })));
    await render({ invitations: [pending] });
    expect(container.querySelector('select')?.querySelector('option[value="owner"]')).toBeNull();
    await click(button('Reissue'));
    let dialog = container.querySelector<HTMLDialogElement>('dialog')!;
    expect(dialog.textContent).toContain('invalidates the previous link');
    expect(dialog.textContent).toContain('No channels selected');
    await confirm(dialog, 'INVITE', 'INVITE MEMBER noura@example.test');
    await click(button('Reissue invitation', dialog));
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body))).toEqual({ email: 'noura@example.test', role: 'contributor', confirmation: 'INVITE MEMBER noura@example.test' });
    expect(container.querySelector('[role=status]')?.textContent).toContain('previous invitation link is no longer valid');
    expect(router.refresh).toHaveBeenCalledOnce();
    expect(container.querySelector<HTMLDialogElement>('dialog')).toBeNull();
  });

  it('revokes only after the exact invitation confirmation and accepts a matching receipt', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respond({ ok: true, id: pending.id, revoked: true })));
    await render({ invitations: [pending] });
    await click(button('Revoke'));
    const dialog = container.querySelector<HTMLDialogElement>('dialog')!;
    expect(dialog.textContent).toContain('REVOKE INVITATION invite-1');
    await confirm(dialog, 'REVOKE', 'REVOKE INVITATION invite-1');
    await click(button('Revoke invitation', dialog));
    const [url, init] = vi.mocked(fetch).mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/settings/team/invitations');
    expect(init.method).toBe('DELETE');
    expect(JSON.parse(String(init.body))).toEqual({ id: pending.id, confirmation: 'REVOKE INVITATION invite-1' });
    expect(container.querySelector('[role=status]')?.textContent).toBe('Invitation for noura@example.test revoked.');
    expect(router.refresh).toHaveBeenCalledOnce();
  });

  it('does not offer revoke for accepted entries and remains readable when creation is unavailable', async () => {
    const accepted = { ...pending, status: 'accepted' as const, acceptedAt: '2026-10-17T13:00:00.000Z' };
    await render({ available: false, invitations: [accepted] });
    expect(container.querySelector('#team-invitation-email')).toBeNull();
    expect(container.textContent).toContain('Invitations are unavailable right now');
    expect(container.textContent).toContain('Accepted Oct 17, 2026');
    expect(container.querySelectorAll('button')).toHaveLength(0);
  });

  it('blocks duplicate submissions while a request is pending', async () => {
    let resolve: ((value: unknown) => void) | undefined;
    vi.stubGlobal('fetch', vi.fn(() => new Promise(done => { resolve = done; })));
    await render();
    const dialog = await inviteDialog();
    await confirm(dialog, 'INVITE', 'INVITE MEMBER noura@example.test');
    const submit = button('Create invitation', dialog);
    await act(async () => { submit.click(); submit.click(); });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(submit.disabled).toBe(true);
    await act(async () => resolve?.(respond({ ok: true, id: 'invite-new', delivery: 'sent', expiresAt: future })));
  });
});
