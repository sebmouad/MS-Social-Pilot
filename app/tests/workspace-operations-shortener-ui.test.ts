// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ToastProvider } from '../src/components/Toast';
import { SettingsCopyProvider } from '../src/modules/settings/ui/copy-context';
import { settingsUiCopy } from '../src/modules/settings/ui/copy-catalog';
import { sectionsCopy } from '../src/modules/settings/ui/sections-copy';
import { WorkspaceCards } from '../src/modules/settings/ui/workspace/WorkspaceCards';
import { WORKSPACE_OPERATIONS_DEFAULTS, workspaceOperationsConfirmation } from '../src/modules/settings/workspace-operations';
let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

const render = (locale: 'en' | 'fr', canManage = true) => act(async () => root.render(createElement(SettingsCopyProvider, { copy: settingsUiCopy, children: createElement(ToastProvider, { dismissLabel: 'x', children: createElement(WorkspaceCards, {
  locale, copy: sectionsCopy[locale], workspaceId: 'w1', workspaceName: 'Acme', canManage, policy: { timezone: 'Europe/Paris', requiresApproval: false, maxTimezoneCharacters: 64 }, operations: WORKSPACE_OPERATIONS_DEFAULTS, timezones: ['Europe/Paris', 'America/New_York'],
}) }) })));
const card = (title: string) => [...container.querySelectorAll('section')].find(section => section.querySelector('h2')?.textContent === title)!;
const saveButton = (title: string) => [...card(title).querySelectorAll<HTMLButtonElement>('button[type="submit"]')][0]!;

it.each(['en', 'fr'] as const)('saves the Links card on its own through the operations API (%s)', async locale => {
  const t = sectionsCopy[locale];
  const fetch = vi.fn().mockImplementation(async (_url: string, init: { body: string }) => Response.json({ ok: true, settings: JSON.parse(init.body).settings }));
  vi.stubGlobal('fetch', fetch);
  await render(locale);
  const links = card(t.links.title);
  expect(saveButton(t.links.title).disabled).toBe(true);
  const toggle = links.querySelector<HTMLButtonElement>('[role="switch"]')!;
  expect(toggle.getAttribute('aria-checked')).toBe('false');
  await act(async () => toggle.click());
  expect(toggle.getAttribute('aria-checked')).toBe('true');
  await act(async () => { saveButton(t.links.title).click(); });
  expect(fetch).toHaveBeenCalledOnce();
  const [url, init] = fetch.mock.calls[0]!;
  expect(url).toBe('/api/settings/workspace/operations');
  const body = JSON.parse(init.body);
  expect(body.confirmation).toBe(workspaceOperationsConfirmation('w1'));
  expect(body.settings.shortenerEnabled).toBe(true);
  expect(body.settings.businessStart).toBe(WORKSPACE_OPERATIONS_DEFAULTS.businessStart);
  expect(saveButton(t.links.title).disabled).toBe(true);
});

it('saves Approvals through the policy API without touching the other cards', async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json({ ok: true }));
  vi.stubGlobal('fetch', fetch);
  await render('en');
  const t = sectionsCopy.en;
  await act(async () => card(t.approvals.title).querySelector<HTMLButtonElement>('[role="switch"]')!.click());
  expect(saveButton(t.queue.title).disabled).toBe(true);
  await act(async () => { saveButton(t.approvals.title).click(); });
  expect(fetch).toHaveBeenCalledOnce();
  expect(fetch.mock.calls[0]![0]).toBe('/api/settings/workspace/policy');
  expect(JSON.parse(fetch.mock.calls[0]![1].body)).toMatchObject({ timezone: 'Europe/Paris', requiresApproval: true, confirmation: 'UPDATE WORKSPACE POLICY w1' });
});

it('keeps the edit and shows the failure when a save is refused, and is read-only for members', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ ok: false, error: 'Nope' }, { status: 403 })));
  await render('en');
  const t = sectionsCopy.en;
  const toggle = card(t.moderation.title).querySelector<HTMLButtonElement>('[role="switch"]')!;
  await act(async () => toggle.click());
  await act(async () => { saveButton(t.moderation.title).click(); });
  expect(card(t.moderation.title).querySelector('[role="alert"]')?.textContent).toBe('Nope');
  expect(toggle.getAttribute('aria-checked')).toBe(String(!WORKSPACE_OPERATIONS_DEFAULTS.watchNegativeComments));
  await render('en', false);
  expect(container.textContent).toContain(t.readOnly);
  expect(container.querySelector('button[type="submit"]')).toBeNull();
});

it.each(['en', 'fr'] as const)('shows the Tasks area card and saves it alone through the operations API (%s)', async locale => {
  const t = sectionsCopy[locale];
  const fetch = vi.fn().mockImplementation(async (_url: string, init: { body: string }) => Response.json({ ok: true, settings: JSON.parse(init.body).settings }));
  vi.stubGlobal('fetch', fetch);
  await render(locale);
  const areas = card(t.areas.title);
  expect(areas.textContent).toContain(t.areas.detail);
  expect(saveButton(t.areas.title).disabled).toBe(true);
  const toggle = areas.querySelector<HTMLButtonElement>('[role="switch"]')!;
  expect(toggle.getAttribute('aria-checked')).toBe('false');
  await act(async () => toggle.click());
  expect(saveButton(t.links.title).disabled).toBe(true);
  await act(async () => { saveButton(t.areas.title).click(); });
  expect(fetch).toHaveBeenCalledOnce();
  const [url, init] = fetch.mock.calls[0]!;
  expect(url).toBe('/api/settings/workspace/operations');
  const body = JSON.parse(init.body);
  expect(body.confirmation).toBe(workspaceOperationsConfirmation('w1'));
  expect(body.settings.tasksAreaEnabled).toBe(true);
});
