// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const deps = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: deps.refresh }) }));
import { PlatformSwitch } from '../src/app/root/platforms/PlatformSwitch';
let root: ReturnType<typeof createRoot>; let container: HTMLDivElement;
beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); this.tabIndex = -1; };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  vi.clearAllMocks(); container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(createElement(PlatformSwitch, { settingKey: 'platforms.example.enabled', name: 'Example', enabled: true })));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
it('names a module before disabling it and accepts only its matching configuration receipt', async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json({ ok: true, values: [{ key: 'platforms.other.enabled', value: false }] })); vi.stubGlobal('fetch', fetch);
  await act(async () => container.querySelector<HTMLButtonElement>('[role=switch]')!.click());
  expect(fetch).not.toHaveBeenCalled(); expect(container.querySelector('dialog')?.textContent).toContain('Example'); expect(document.activeElement?.textContent).toBe('Cancel');
  const confirm = [...container.querySelectorAll<HTMLButtonElement>('dialog button')].find(button => button.textContent === 'Off')!;
  await act(async () => confirm.click()); expect(container.querySelector('dialog [role=alert]')).not.toBeNull();
  expect(container.querySelector('[role=switch]')?.getAttribute('aria-checked')).toBe('true'); expect(deps.refresh).not.toHaveBeenCalled();
  fetch.mockResolvedValue(Response.json({ ok: true, values: [{ key: 'platforms.example.enabled', value: false }] }));
  await act(async () => confirm.click()); expect(container.querySelector('dialog')).toBeNull();
  expect(container.querySelector('[role=switch]')?.getAttribute('aria-checked')).toBe('false'); expect(deps.refresh).toHaveBeenCalledOnce();
});
