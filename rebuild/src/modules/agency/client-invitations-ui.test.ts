// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clientInvitationDefaults, clientInvitationCopy, clientInviteConfirmation } from './invitation-policy';
const actions = vi.hoisted(() => ({ create: vi.fn(), remove: vi.fn(), reload: vi.fn() }));
vi.mock('./ui/clients/invitation-actions', () => ({ createClientInvitation: actions.create, removeClientInvitation: actions.remove, reloadClientInvitations: actions.reload }));
import { ClientInvitationsManager } from './ui/clients/ClientInvitationsManager';
const initial = { invitations: [{ id: 'invite-a', email: 'client@example.test', workspaceName: 'Lumière', expiresAt: '2026-11-05T00:00:00Z', createdAt: '2026-10-22T00:00:00Z', status: 'pending' as const }], truncated: false, policy: { ...clientInvitationDefaults, enabled: true } };
let root: ReturnType<typeof createRoot>; let container: HTMLDivElement;
const button = (text: string, scope: ParentNode = document) => [...scope.querySelectorAll('button')].find(item => item.textContent === text)!;
const click = (element: HTMLElement) => act(async () => element.click());
async function fill(input: HTMLInputElement, value: string) {
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); });
}
beforeEach(() => {
  vi.clearAllMocks();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  actions.reload.mockResolvedValue(initial);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
const render = (locale: 'en' | 'fr' = 'en', directory = initial) => act(async () => root.render(createElement(ClientInvitationsManager, { initial: directory, locale, copy: clientInvitationCopy[locale] })));

describe('client invitation manager', () => {
  it('requires exact consent and keeps a one-time link when directory refresh fails', async () => {
    await render();
    await fill(container.querySelector('[name="email"]')!, 'new@example.test');
    await fill(container.querySelector('[name="workspaceName"]')!, 'Atelier');
    await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    const dialog = document.querySelector('[role="dialog"], dialog')!;
    expect(actions.create).not.toHaveBeenCalled(); expect(button(clientInvitationCopy.en.create, dialog).disabled).toBe(true);
    await fill(dialog.querySelector('input')!, clientInviteConfirmation('new@example.test', 'Atelier'));
    actions.create.mockResolvedValueOnce({ created: true, id: 'new-invite', url: 'https://pilot.example.test/register#client=private-once', delivery: 'uncertain' });
    actions.reload.mockRejectedValueOnce(new Error('temporary refresh error'));
    await click(button(clientInvitationCopy.en.create, dialog));
    expect(actions.create).toHaveBeenCalledWith({ email: 'new@example.test', workspaceName: 'Atelier', locale: 'en', confirmation: clientInviteConfirmation('new@example.test', 'Atelier') });
    expect(container.querySelector('textarea')?.value).toContain('#client=private-once');
    expect(container.textContent).toContain(clientInvitationCopy.en.mailUnavailable);
    expect(document.querySelector('[role="dialog"], dialog')).toBeNull();
    expect(button(clientInvitationCopy.en.create, container).disabled).toBe(true);
    await click(button(clientInvitationCopy.en.hideLink)); expect(container.querySelector('textarea')).toBeNull();
  });

  it('preserves failed French revocation confirmation and does not revoke accepted accounts', async () => {
    await render('fr', { ...initial, invitations: [...initial.invitations, { ...initial.invitations[0]!, id: 'accepted', email: 'accepted@example.test', status: 'accepted' as 'pending' }] });
    expect(container.querySelectorAll('button[aria-label^="Révoquer"]')).toHaveLength(1);
    await click(button(clientInvitationCopy.fr.revoke));
    const dialog = document.querySelector('[role="dialog"], dialog')!;
    await fill(dialog.querySelector('input')!, 'REVOKE CLIENT INVITATION invite-a');
    actions.remove.mockRejectedValueOnce(new Error('private database information'));
    await click(button(clientInvitationCopy.fr.revoke, dialog));
    expect(dialog.querySelector('input')?.value).toBe('REVOKE CLIENT INVITATION invite-a');
    expect(dialog.textContent).toContain(clientInvitationCopy.fr.failed);
    expect(dialog.textContent).not.toContain('private database');
    await click(button(clientInvitationCopy.fr.cancel, dialog));
    expect(actions.remove).toHaveBeenCalledTimes(1);
  });

  it('shows disabled creation and localized empty state without fetching on mount', async () => {
    await render('fr', { ...initial, invitations: [], policy: clientInvitationDefaults });
    expect(container.textContent).toContain(clientInvitationCopy.fr.disabled);
    expect(container.textContent).toContain(clientInvitationCopy.fr.empty);
    expect(actions.reload).not.toHaveBeenCalled();
    expect(container.querySelector('form')).toBeNull();
  });
});
