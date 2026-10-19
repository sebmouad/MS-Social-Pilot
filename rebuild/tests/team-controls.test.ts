// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

import { TeamControls } from '../src/modules/settings/ui/team/TeamControls';

let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
const respond = (body: unknown, ok = true) => ({ ok, json: async () => body });
const baseProps = {
  members: [{ id: 'member-1', userId: 'person-1', role: 'contributor', name: 'Noura', email: 'noura@example.test', allPages: false, targetIds: ['channel-a', 'channel-hidden'] }],
  targets: [{ id: 'channel-a', name: 'Studio page', type: 'facebook' }],
  actorId: 'actor-1', actorRole: 'admin', total: 1, hasMore: false,
};

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); this.tabIndex = -1; };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

async function render(props: Partial<typeof baseProps> & { defaultRole?: string; defaultAllPages?: boolean } = {}) {
  await act(async () => root.render(createElement(TeamControls, { ...baseProps, ...props })));
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
async function addDialog(email = ' NEWPERSON@EXAMPLE.TEST ') {
  const emailField = container.querySelector<HTMLInputElement>('#team-member-email')!;
  await enter(emailField, email);
  await click(button('Review member access'));
  return container.querySelector<HTMLDialogElement>('dialog')!;
}
async function confirm(dialog: HTMLDialogElement, action: 'ADD' | 'UPDATE' | 'REMOVE', phrase: string) {
  await enter(dialog.querySelector<HTMLInputElement>(`[aria-label="${action} confirmation"]`)!, phrase);
}

describe('Team controls lifecycle', () => {
  it('uses Root defaults for new members and accepts only a complete add receipt', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respond({ ok: true, id: 'new-membership', added: true })));
    await render({ defaultRole: 'viewer', defaultAllPages: true });
    expect(container.querySelector<HTMLSelectElement>('form select')?.value).toBe('viewer');
    expect(container.querySelector<HTMLInputElement>('form input[type="checkbox"]')?.checked).toBe(true);

    const dialog = await addDialog();
    expect(dialog.textContent).toContain('newperson@example.test');
    expect(dialog.textContent).toContain('Viewer');
    await confirm(dialog, 'ADD', 'ADD MEMBER newperson@example.test');
    await click(button('Add member', dialog));

    const [url, init] = vi.mocked(fetch).mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/settings/team');
    expect(JSON.parse(String(init.body))).toMatchObject({ email: 'newperson@example.test', role: 'viewer', allPages: true, targetIds: [], confirmation: 'ADD MEMBER newperson@example.test' });
    expect(router.refresh).toHaveBeenCalledOnce();
    expect(container.querySelector('dialog')).toBeNull();
    expect(container.querySelector('[role=status]')?.textContent).toBe('Member added.');
  });

  it('retains hidden grants after a failed update and removes them only on explicit choice', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(respond({ error: 'The update could not be saved.', code: 'conflict' }, false))
      .mockResolvedValueOnce(respond({ ok: true, id: 'member-1', updated: true }));
    vi.stubGlobal('fetch', fetch);
    await render();
    await click(button('Edit access'));
    let dialog = container.querySelector<HTMLDialogElement>('dialog')!;
    expect(dialog.textContent).toContain('1 channel access grant is unavailable');
    expect(dialog.textContent).toContain('Keep these grants or remove them explicitly');

    await confirm(dialog, 'UPDATE', 'UPDATE MEMBER member-1');
    await click(button('Save access', dialog));
    expect(dialog.open).toBe(true);
    expect(dialog.querySelector('[role=alert]')?.textContent).toBe('The update could not be saved.');
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(dialog.querySelectorAll<HTMLInputElement>('fieldset label input[type="checkbox"]')[1]?.checked).toBe(true);
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toMatchObject({ targetIds: ['channel-a', 'channel-hidden'], allPages: false });

    await click(button('Remove 1 unavailable channel grant', dialog));
    expect(dialog.textContent).toContain('Saving will remove 1 unavailable channel grant from this member');
    expect(dialog.textContent).not.toContain('channel-hidden');
    await confirm(dialog, 'UPDATE', 'UPDATE MEMBER member-1');
    await click(button('Save access', dialog));
    expect(JSON.parse(String(fetch.mock.calls[1]?.[1]?.body))).toMatchObject({ targetIds: ['channel-a'], allPages: false });
    expect(router.refresh).toHaveBeenCalledOnce();
    expect(container.querySelector('[role=status]')?.textContent).toBe('Member access updated.');
  });

  it('rejects an update receipt for a different membership and keeps the edit recoverable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respond({ ok: true, id: 'another-member', updated: true })));
    await render();
    await click(button('Edit access'));
    const dialog = container.querySelector<HTMLDialogElement>('dialog')!;
    await confirm(dialog, 'UPDATE', 'UPDATE MEMBER member-1');
    await click(button('Save access', dialog));
    expect(dialog.open).toBe(true);
    expect(dialog.querySelector('[role=alert]')?.textContent).toMatch(/could not confirm whether this change completed.*refresh.*before retrying/i);
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it('blocks same-tick duplicate submissions and aborts the request when unmounted', async () => {
    let signal: AbortSignal | undefined;
    vi.stubGlobal('fetch', vi.fn((_url: string | URL | Request, init?: RequestInit) => {
      signal = init?.signal as AbortSignal | undefined;
      return new Promise(() => {});
    }));
    await render();
    const dialog = await addDialog('another@example.test');
    await confirm(dialog, 'ADD', 'ADD MEMBER another@example.test');
    const submit = button('Add member', dialog);
    await act(async () => { submit.click(); submit.click(); });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(submit.disabled).toBe(true);
    await act(async () => root.unmount());
    expect(signal?.aborted).toBe(true);
  });

  it('accepts only a matching remove receipt', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respond({ ok: true, id: 'member-1', removed: true })));
    await render();
    await click(button('Remove'));
    const dialog = container.querySelector<HTMLDialogElement>('dialog')!;
    expect(dialog.textContent).toContain('Their account and access to other workspaces stay available.');
    await confirm(dialog, 'REMOVE', 'REMOVE MEMBER member-1');
    await click(button('Remove from workspace', dialog));
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body))).toMatchObject({ membershipId: 'member-1', confirmation: 'REMOVE MEMBER member-1' });
    expect(router.refresh).toHaveBeenCalledOnce();
    expect(container.querySelector('[role=status]')?.textContent).toBe('Member removed from this workspace.');
  });
});
