// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { WorkspaceOperationsForm } from '../src/modules/settings/ui/workspace/operations-form';
import { WORKSPACE_OPERATIONS_DEFAULTS, workspaceOperationsConfirmation } from '../src/modules/settings/workspace-operations';
import { workspaceOperationsCopy } from '../src/modules/settings/workspace-operations-copy';
let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); }; HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

it.each(['en', 'fr'] as const)('renders the link shortening switch (%s) and saves it through the settings API', async locale => {
  const t = workspaceOperationsCopy[locale];
  const fetch = vi.fn().mockImplementation(async (_url: string, init: { body: string }) => Response.json({ ok: true, settings: JSON.parse(init.body).settings }));
  vi.stubGlobal('fetch', fetch);
  await act(async () => root.render(createElement(WorkspaceOperationsForm, { workspaceId: 'w1', initial: WORKSPACE_OPERATIONS_DEFAULTS, locale })));
  const label = [...container.querySelectorAll('label')].find(item => item.textContent?.includes(t.shortenLinks))!;
  const box = label.querySelector('input')!;
  expect(box.checked).toBe(false);
  expect(container.textContent).toContain(t.shortenHint);
  await act(async () => box.click());
  expect(box.checked).toBe(true);
  await act(async () => { container.querySelector('form')!.requestSubmit(); });
  expect(fetch).not.toHaveBeenCalled();
  const dialog = container.querySelector('dialog')!;
  expect(dialog.textContent).toContain('w1'); expect(dialog.querySelector('input')).toBeNull();
  await act(async () => { [...dialog.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === t.save)!.click(); });
  expect(fetch).toHaveBeenCalledOnce();
  expect(JSON.parse(fetch.mock.calls[0]![1].body).settings.shortenerEnabled).toBe(true);
});
