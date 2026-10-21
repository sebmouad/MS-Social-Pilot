// @vitest-environment jsdom
import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ThemeProvider } from '@/components/ThemeProvider';
import { ToastProvider } from '@/components/Toast';
import { SettingsPage } from '@/modules/settings/ui/_components';
import { AgencyHeading } from '@/modules/agency/ui/AgencyChrome';
import { AppearancePicker } from '@/modules/settings/ui/appearance/picker';
import { appearanceCopy } from '@/modules/settings/ui/appearance/copy';
import { ConnectionManager } from '@/modules/settings/ui/connections/manager';
import { McpKeyManager } from '@/modules/settings/ui/mcp/keys';
import { WorkspaceExports } from '@/modules/settings/ui/data/exports';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

let root: ReturnType<typeof createRoot>, container: HTMLDivElement;
const reply = (body: unknown, ok = true) => ({ ok, json: async () => body } as Response);
const click = (element: HTMLElement) => act(async () => { element.click(); });
function button(text: string, parent: ParentNode = container) {
  const found = [...parent.querySelectorAll<HTMLButtonElement>('button')].find(element => element.textContent?.trim() === text);
  if (!found) throw new Error(`Missing button: ${text}`);
  return found;
}
const render = (children: ReactNode) => act(async () => { root.render(createElement(ToastProvider, { children })); });
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

it('uses one shared title and colored module chip for Settings and Agency', () => {
  const settings = renderToStaticMarkup(createElement(SettingsPage, { active: 'settings/account', title: 'Compte', description: 'Votre profil', locale: 'fr', children: null }));
  const agency = renderToStaticMarkup(createElement(AgencyHeading, { description: 'Client workspaces' }));
  for (const html of [settings, agency]) {
    expect(html.match(/<h1>/g)).toHaveLength(1);
    expect(html).toContain('ui-page-header__chip'); expect(html).toContain('<svg');
  }
});

it('previews all themes and modes live, then saves through the appearance service without reloading', async () => {
  vi.mocked(fetch).mockResolvedValue(reply({ ok: true }));
  await render(createElement(ThemeProvider, { initialTheme: 'vivid', initialMode: 'light', children: createElement(AppearancePicker, { initialTheme: 'vivid', initialMode: 'light', copy: appearanceCopy.fr, canWrite: true }) }));
  expect(container.querySelectorAll('input[type=radio]')).toHaveLength(4);
  await click(container.querySelector<HTMLInputElement>('input[value=warm]')!);
  await click(button('Sombre'));
  expect(document.documentElement.dataset.theme).toBe('warm'); expect(document.documentElement.dataset.mode).toBe('dark');
  await click(button('Enregistrer l’apparence'));
  expect(fetch).toHaveBeenCalledWith('/api/settings/appearance', expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ theme: 'warm', mode: 'dark', confirmation: 'UPDATE APPEARANCE' }) }));
  expect(container.textContent).toContain('Apparence enregistrée.');
});

it('retains the selected appearance on failure and retries from the shared toast', async () => {
  vi.mocked(fetch).mockResolvedValueOnce(reply({}, false)).mockResolvedValueOnce(reply({ ok: true }));
  await render(createElement(ThemeProvider, { initialTheme: 'vivid', children: createElement(AppearancePicker, { initialTheme: 'vivid', initialMode: 'system', copy: appearanceCopy.en, canWrite: true }) }));
  await click(container.querySelector<HTMLInputElement>('input[value=clean]')!);
  await click(button('Save appearance'));
  expect(container.querySelector<HTMLInputElement>('input[value=clean]')?.checked).toBe(true);
  const alert = container.querySelector('[role=alert]')!;
  expect(alert.textContent).toContain('could not be saved');
  await click(button('Save appearance', alert));
  expect(fetch).toHaveBeenCalledTimes(2);
});

it('keeps retain/delete selection before a named disconnect confirmation, and holds that dialog on failure', async () => {
  vi.mocked(fetch).mockResolvedValue(reply({ error: 'Connection changed. Review it and try again.' }, false));
  await render(createElement(ConnectionManager, {
    sources: [{ id: 'source', name: 'Studio account', provider: 'example', invalidatedAt: null, tokenExpiresAt: null, targets: [], adAccounts: [] }],
    platforms: [], canManage: true, statusLabels: { connected: 'Connected', expired: 'Reconnect needed', revoked: 'Reconnect needed' }, initialSourceId: 'source', initialAction: 'disconnect',
  }));
  expect(container.querySelectorAll('input[type=radio]')).toHaveLength(2);
  await click(button('Disconnect and retain data'));
  expect(fetch).not.toHaveBeenCalled();
  const dialog = container.querySelector('dialog')!;
  expect(dialog.textContent).toContain('Studio account'); expect(dialog.textContent).toContain('Neither choice revokes');
  await click(button('Disconnect and retain data', dialog));
  expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body))).toMatchObject({ socialAccountId: 'source', mode: 'retain' });
  expect(container.querySelector('dialog[open]')?.textContent).toContain('Connection changed.');
});

it('names the key being revoked and preserves a failed revoke for retry', async () => {
  vi.mocked(fetch).mockResolvedValue(reply({ error: 'Access changed.' }, false));
  await render(createElement(McpKeyManager, { features: [], initialKeys: [{ id: 'key', name: 'Studio automation', tokenPrefix: 'synthetic', readFeatures: [], writeFeatures: [], expiresAt: '2099-01-01', revokedAt: null, createdAt: '2026-01-01', lastUsedAt: null }], maxLifetimeDays: 180, defaultLifetimeDays: 30, resources: [], resourcesTruncated: false }));
  expect(container.querySelector('table.ui-table--stack')).not.toBeNull();
  await click(button('Revoke'));
  const dialog = container.querySelector('dialog')!;
  expect(dialog.textContent).toContain('Studio automation');
  const confirm = [...dialog.querySelectorAll<HTMLButtonElement>('button')].find(item => item.classList.contains('ui-button--danger'))!;
  await click(confirm);
  expect(container.querySelector('dialog[open]')?.textContent).toContain('Access changed.');
  expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body))).toEqual({ id: 'key', confirmation: 'REVOKE MCP KEY key' });
});

it('requests an export only after confirmation and keeps the dialog on an unconfirmed response', async () => {
  vi.mocked(fetch).mockResolvedValueOnce(reply({ jobs: [] })).mockResolvedValueOnce(reply({}, false));
  await render(createElement(WorkspaceExports, { workspaceId: 'workspace', locale: 'en' }));
  await click(button('Request workspace ZIP'));
  expect(fetch).toHaveBeenCalledTimes(1);
  const dialog = container.querySelector('dialog')!;
  await click(button('Request workspace ZIP', dialog));
  expect(JSON.parse(String(vi.mocked(fetch).mock.calls[1]?.[1]?.body))).toEqual({ confirmation: 'REQUEST WORKSPACE EXPORT workspace' });
  expect(container.querySelector('dialog[open]')?.textContent).toContain('could not be confirmed');
});
