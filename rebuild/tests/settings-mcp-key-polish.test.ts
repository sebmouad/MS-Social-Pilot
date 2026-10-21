// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { McpKeyManager } from '@/modules/settings/ui/mcp/keys';
import { settingsUiCopy, settingsUiCopySchema } from '@/modules/settings/ui/copy-catalog';
import { ToastProvider } from '@/components/Toast';

let root: ReturnType<typeof createRoot>, container: HTMLDivElement;
const features = [
  { id: 'publishing/queue', name: 'Queue', module: 'publishing', moduleLabel: 'Publishing', canRead: true, canWrite: true },
  { id: 'inbox/conversations', name: 'Conversations', module: 'inbox', moduleLabel: 'Inbox', canRead: true, canWrite: false },
];
const mount = (locale: 'en' | 'fr' = 'en') => act(async () => root.render(createElement(ToastProvider, { children: createElement(McpKeyManager, { features, initialKeys: [], maxLifetimeDays: 90, defaultLifetimeDays: 30, resources: [], resourcesTruncated: false, locale }) })));
const byText = (text: string) => [...container.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.trim() === text)!;
beforeEach(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; container = document.createElement('div'); document.body.append(container); root = createRoot(container); vi.stubGlobal('fetch', vi.fn()); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

it('keeps EN and FR catalogs in the exact shape with the new preset keys', () => {
  const copy = settingsUiCopySchema.parse(settingsUiCopy);
  for (const key of ['presetRead', 'presetReadWrite', 'presetClear', 'summary', 'lifetimeRange', 'lifetimeHint', 'moduleAll']) {
    expect((copy.mcp.en as Record<string, string>)[key]).toBeTruthy();
    expect((copy.mcp.fr as Record<string, string>)[key]).toBeTruthy();
  }
});
it('presets select only permitted features and update the summary', async () => {
  await mount();
  expect(container.textContent).toContain('0 readable · 0 writable');
  await act(async () => byText('Read and write everything').click());
  expect(container.textContent).toContain('2 readable · 1 writable');
  await act(async () => byText('Read everything').click());
  expect(container.textContent).toContain('2 readable · 0 writable');
  await act(async () => byText('Clear').click());
  expect(container.textContent).toContain('0 readable · 0 writable');
});
it('shows the lifetime ceiling and rejects an out-of-range lifetime inline without calling the API', async () => {
  await mount('fr');
  expect(container.textContent).toContain('Jusqu’à 90 jours.');
  const life = container.querySelector<HTMLInputElement>('input[name=expiresInDays]')!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(life, '500'); life.dispatchEvent(new Event('input', { bubbles: true })); });
  await act(async () => { container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  expect(container.textContent).toContain('entre 1 et 90');
  expect(fetch).not.toHaveBeenCalled();
});
