// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { JoinForm } from '@/app/join/join-form';

let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
const token = Buffer.alloc(32, 11).toString('base64url');
const preview = { id: 'invite-1', email: 'member@example.test', workspaceName: 'Example Workspace', role: 'editor', expiresAt: '2026-10-18T00:00:00.000Z', existingAccount: false, signedInEmail: null, needsEnrollment: false };
const respond = (body: unknown, ok = true, status = ok ? 200 : 409) => ({ ok, status, json: async () => body });

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  window.history.replaceState(null, '', `/#${token}`);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove(); vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

async function render(locale: 'en' | 'fr' = 'en') {
  await act(async () => root.render(createElement(JoinForm, { passwordPolicy: { minLength: 8, maxBytes: 800 }, locale })));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
}
function button(text: string) {
  const result = Array.from(container.querySelectorAll('button')).find(item => item.textContent?.trim() === text);
  if (!result) throw new Error(`Missing button: ${text}`);
  return result as HTMLButtonElement;
}
async function fill(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => { setter.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); });
}

describe('join invitation form', () => {
  it.each(['en', 'fr'] as const)('shows a focused localized empty state for a tokenless %s visit', async locale => {
    window.history.replaceState(null, '', '/join');
    vi.stubGlobal('fetch', vi.fn(async () => respond({ invitation: null })));
    await render(locale);
    const notice = container.querySelector('[role="alert"]');
    expect(notice?.textContent).toContain(locale === 'en' ? 'Use the link from your invitation email' : 'Utilisez le lien de votre e-mail');
    expect(document.activeElement).toBe(notice);
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body))).toEqual({});
    expect(container.querySelector('a[href="/sign-in"]')).not.toBeNull();
    expect(container.querySelector('form')).toBeNull();
  });

  it('continues an invitation from the cookie when the URL has no fragment', async () => {
    window.history.replaceState(null, '', '/join');
    vi.stubGlobal('fetch', vi.fn(async () => respond(preview)));
    await render();
    expect(container.textContent).toContain(preview.workspaceName);
    expect(container.querySelector('[name="name"]')).not.toBeNull();
  });

  it('does not mistake lookup failure for an empty invitation', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respond({ error: 'private upstream detail' }, false, 500)));
    await render('fr');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('ouverte');
    expect(container.textContent).not.toContain('private upstream detail');
  });

  it('removes the fragment before fetching and carries the token only in the preview request body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respond(preview)));
    await render();
    expect(window.location.hash).toBe('');
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = vi.mocked(fetch).mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/auth/invitations/preview');
    expect(JSON.parse(String(init.body))).toEqual({ token });
    expect(url).not.toContain(token);
    expect(container.textContent).toContain('Example Workspace');
  });

  it('preserves registration fields after a recoverable failure and never resends the token', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(respond(preview))
      .mockResolvedValueOnce(respond({ error: 'The invitation is no longer available.' }, false)));
    await render();
    const name = container.querySelector<HTMLInputElement>('[name="name"]')!;
    const password = container.querySelector<HTMLInputElement>('[name="password"]')!;
    await fill(name, 'Member Name');
    await fill(password, 'long-password');
    await act(async () => button('Create account and join').click());
    expect(await vi.mocked(fetch).mock.results[1]?.value).toBeDefined();
    expect(name.value).toBe('Member Name');
    expect(password.value).toBe('long-password');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('no longer available');
    const calls = vi.mocked(fetch).mock.calls as unknown as Array<[string, RequestInit]>;
    expect(calls.every(([url]) => url === '/api/auth/invitations/preview' || url === '/api/auth/invitations/register')).toBe(true);
    expect(JSON.parse(String(calls[1][1].body))).toEqual({ name: 'Member Name', password: 'long-password', confirmation: 'CREATE ACCOUNT AND JOIN invite-1' });
    expect(calls.map(([url]) => url).join(' ')).not.toContain(token);
    expect(JSON.stringify(calls.slice(1))).not.toContain(token);
  });

  it('focuses the first invalid registration field', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respond(preview)));
    await render();
    await act(async () => button('Create account and join').click());
    expect(document.activeElement).toBe(container.querySelector('[name="name"]'));
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('clears the password and exposes a sign-in receipt only after account creation is confirmed', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(respond(preview))
      .mockResolvedValueOnce(respond({ ok: true, created: true, workspaceId: 'workspace-1', next: '/sign-in' })));
    await render();
    const name = container.querySelector<HTMLInputElement>('[name="name"]')!;
    const password = container.querySelector<HTMLInputElement>('[name="password"]')!;
    await fill(name, 'Member Name'); await fill(password, 'long-password');
    await act(async () => button('Create account and join').click());
    expect(container.textContent).toContain('Your account and workspace membership were created');
    expect(container.querySelector('a[href="/sign-in"]')).not.toBeNull();
    expect(container.querySelector('[name="password"]')).toBeNull();
  });
});
