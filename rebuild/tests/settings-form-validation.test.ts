// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

import { AccountManager } from '../src/modules/settings/ui/account/manager';
import { McpKeyManager } from '../src/modules/settings/ui/mcp/keys';
import { TeamControls } from '../src/modules/settings/ui/team/TeamControls';

let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
let originalClipboard: PropertyDescriptor | undefined;
const feature = { id: 'publishing', name: 'Publishing', module: 'Publishing', canRead: true, canWrite: true };
const key = { id: 'key-1', name: 'Existing', tokenPrefix: 'sp_test', readFeatures: ['publishing'], writeFeatures: [], expiresAt: '2099-01-01T00:00:00.000Z', revokedAt: null, createdAt: '2026-01-01T00:00:00.000Z', lastUsedAt: null };

async function render(node: React.ReactNode) {
  await act(async () => root.render(createElement('div', null, node)));
}

async function submit(form: HTMLFormElement) {
  await act(async () => form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true })));
}

beforeEach(() => {
  vi.clearAllMocks();
  originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ sessions: [] }) })));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard); else Reflect.deleteProperty(navigator, 'clipboard'); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('settings form validation', () => {
  it('associates and focuses a missing profile name without sending a request', async () => {
    await render(createElement(AccountManager, { initialName: 'Samira', email: 'samira@example.test', passwordPolicy: { minLength: 12, maxBytes: 800 } }));
    const form = container.querySelector('form')!;
    const name = form.querySelector<HTMLInputElement>('[name="name"]')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => { setter.call(name, '   '); name.dispatchEvent(new Event('input', { bubbles: true })); });
    vi.mocked(fetch).mockClear();
    await submit(form);
    expect(name.getAttribute('aria-invalid')).toBe('true');
    expect(name.getAttribute('aria-describedby')).toBeTruthy();
    expect(document.getElementById(name.getAttribute('aria-describedby')!)?.textContent).toMatch(/required|enter/i);
    expect(document.activeElement).toBe(name);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects invalid team email in the form and focuses the associated field', async () => {
    await render(createElement(TeamControls, { members: [], targets: [], actorId: 'actor-1', actorRole: 'admin' }));
    const form = container.querySelector('form')!;
    const email = form.querySelector<HTMLInputElement>('[name="email"]')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => { setter.call(email, 'not-an-email'); email.dispatchEvent(new Event('input', { bubbles: true })); });
    vi.mocked(fetch).mockClear();
    await submit(form);
    expect(email.getAttribute('aria-invalid')).toBe('true');
    expect(email.getAttribute('aria-describedby')).toBeTruthy();
    expect(document.activeElement).toBe(email);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('shows and focuses the missing current password before changing credentials', async () => {
    await render(createElement(AccountManager, { initialName: 'Samira', email: 'samira@example.test', passwordPolicy: { minLength: 12, maxBytes: 800 } }));
    const form = container.querySelectorAll('form')[1]!;
    const password = form.querySelector<HTMLInputElement>('[name="currentPassword"]')!;
    vi.mocked(fetch).mockClear();
    await submit(form);
    expect(password.getAttribute('aria-invalid')).toBe('true');
    expect(password.getAttribute('aria-describedby')).toBeTruthy();
    expect(document.activeElement).toBe(password);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('checks the password byte limit in UTF-8 before sending credentials', async () => {
    await render(createElement(AccountManager, { initialName: 'Samira', email: 'samira@example.test', passwordPolicy: { minLength: 2, maxBytes: 4 } }));
    const form = container.querySelectorAll('form')[1]!;
    const current = form.querySelector<HTMLInputElement>('[name="currentPassword"]')!;
    const next = form.querySelector<HTMLInputElement>('[name="newPassword"]')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      setter.call(current, 'current'); current.dispatchEvent(new Event('input', { bubbles: true }));
      setter.call(next, 'ééé'); next.dispatchEvent(new Event('input', { bubbles: true }));
    });
    vi.mocked(fetch).mockClear();
    await submit(form);
    expect(next.getAttribute('aria-invalid')).toBe('true');
    expect(document.getElementById(next.getAttribute('aria-describedby')!)?.textContent).toMatch(/4 bytes/i);
    expect(document.activeElement).toBe(next);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('requires a key name, valid lifetime and at least one readable feature before creating', async () => {
    await render(createElement(McpKeyManager, { features: [feature], initialKeys: [key], maxLifetimeDays: 180,defaultLifetimeDays:90,resources:[],resourcesTruncated:false }));
    const form = container.querySelector('form')!;
    const name = form.querySelector<HTMLInputElement>('[name="name"]')!;
    vi.mocked(fetch).mockClear();
    await submit(form);
    expect(name.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(name);
    expect(fetch).not.toHaveBeenCalled();

    const nameSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => { nameSetter.call(name, 'automation'); name.dispatchEvent(new Event('input', { bubbles: true })); });
    const lifetime = form.querySelector<HTMLInputElement>('[name="expiresInDays"]')!;
    await act(async () => { lifetime.value = '181'; lifetime.dispatchEvent(new Event('input', { bubbles: true })); lifetime.dispatchEvent(new Event('change', { bubbles: true })); });
    await submit(form);
    expect(lifetime.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(lifetime);
    expect(fetch).not.toHaveBeenCalled();

    await act(async () => { lifetime.value = '30'; lifetime.dispatchEvent(new Event('input', { bubbles: true })); lifetime.dispatchEvent(new Event('change', { bubbles: true })); });
    await submit(form);
    const featureErrorId = form.querySelector<HTMLInputElement>('[name="features"]')?.getAttribute('aria-describedby');
    expect(featureErrorId && document.getElementById(featureErrorId)?.textContent).toMatch(/select at least one readable feature/i);
    expect(document.activeElement).toBe(form.querySelector('[name="features"]'));
    expect(fetch).not.toHaveBeenCalled();
    expect(name.value).toBe('automation');
  });

  it('masks a newly issued token until the keyboard-operable show control is activated', async () => {
    vi.mocked(fetch).mockImplementation(async input => String(input).includes('mcp-keys')
      ? ({ ok: true, json: async () => ({ token: 'sp_secret_token_value', key: { ...key, id: 'created-key' } }) } as Response)
      : ({ ok: true, json: async () => ({ sessions: [] }) } as Response));
    await render(createElement(McpKeyManager, { features: [feature], initialKeys: [], maxLifetimeDays: 180,defaultLifetimeDays:90,resources:[],resourcesTruncated:false }));
    const form = container.querySelector('form')!;
    const name = form.querySelector<HTMLInputElement>('[name="name"]')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => { setter.call(name, 'automation'); name.dispatchEvent(new Event('input', { bubbles: true })); form.querySelector<HTMLInputElement>('input[type="checkbox"][name="features"]')!.click(); });
    await act(async()=>{form.querySelector<HTMLInputElement>('[name=permissionConsent]')!.click();});
    await submit(form);
    expect(container.querySelector<HTMLTextAreaElement>('#new-api-token')?.value).not.toContain('sp_secret_token_value');
    const toggle = container.querySelector<HTMLButtonElement>('button[aria-pressed]')!;
    await act(async () => toggle.click());
    expect(container.querySelector<HTMLTextAreaElement>('#new-api-token')?.value).toBe('sp_secret_token_value');
    expect(toggle.textContent).toMatch(/hide token/i);
    expect(toggle.getAttribute('aria-controls')).toBe('new-api-token');
    await act(async () => container.querySelector<HTMLTextAreaElement>('#new-api-token')!.focus());
    expect(container.querySelector<HTMLTextAreaElement>('#new-api-token')!.selectionStart).toBe(0);
    expect(container.querySelector<HTMLTextAreaElement>('#new-api-token')!.selectionEnd).toBe('sp_secret_token_value'.length);
  });

  it('copies a token only on request and keeps it masked with safe success or failure feedback', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    vi.mocked(fetch).mockImplementation(async input => String(input).includes('mcp-keys')
      ? ({ ok: true, json: async () => ({ token: 'sp_secret_token_value', key: { ...key, id: 'created-key' } }) } as Response)
      : ({ ok: true, json: async () => ({ sessions: [] }) } as Response));
    await render(createElement(McpKeyManager, { features: [feature], initialKeys: [], maxLifetimeDays: 180,defaultLifetimeDays:90,resources:[],resourcesTruncated:false }));
    const form = container.querySelector('form')!;
    const name = form.querySelector<HTMLInputElement>('[name="name"]')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => { setter.call(name, 'automation'); name.dispatchEvent(new Event('input', { bubbles: true })); form.querySelector<HTMLInputElement>('input[type="checkbox"][name="features"]')!.click(); });
    await act(async()=>{form.querySelector<HTMLInputElement>('[name=permissionConsent]')!.click();});
    await submit(form);

    const token = container.querySelector<HTMLTextAreaElement>('#new-api-token')!;
    const copy = Array.from(token.parentElement!.querySelectorAll('button')).find(button => button.textContent === 'Copy token')!;
    await act(async () => copy.click());
    expect(writeText).toHaveBeenCalledWith('sp_secret_token_value');
    expect(token.value).not.toContain('sp_secret_token_value');
    expect(container.querySelector('#new-api-token-copy-status')?.textContent).toBe('Token copied to clipboard.');
    expect(container.querySelector('#new-api-token-copy-status')?.textContent).not.toContain('sp_secret_token_value');

    writeText.mockRejectedValueOnce(new Error('clipboard denied'));
    await act(async () => copy.click());
    expect(token.value).not.toContain('sp_secret_token_value');
    expect(container.querySelector('#new-api-token-copy-status')?.textContent).toMatch(/could not copy.*manually/i);
    expect(container.querySelector('#new-api-token-copy-status')?.textContent).not.toContain('clipboard denied');
    expect(container.querySelector('#new-api-token-copy-status')?.textContent).not.toContain('sp_secret_token_value');
  });
});
