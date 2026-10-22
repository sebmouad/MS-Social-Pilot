// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ rename: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: state.refresh }) }));
vi.mock('@/components/SidebarDock', () => ({ SidebarDock: ({ children }: { children: import('react').ReactNode }) => children }));
vi.mock('@/modules/media/ui/rename-action', () => ({ renameMediaAction: state.rename }));
import { FeedManager, type Feed } from '@/modules/feeds/ui/FeedManager';
import { MediaLibrary, type Asset } from '@/modules/media/ui/MediaLibrary';
let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
  vi.clearAllMocks(); container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
const click = async (node: HTMLElement) => act(async () => { node.click(); });
const input = async (node: HTMLInputElement, value: string) => act(async () => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(node, value);
  node.dispatchEvent(new Event('input', { bubbles: true }));
});
it('shows real feed post text as plain text and a safe link in French', async () => {
  const feed = { id: 'f1', name: 'Blog', url: 'https://example.com', kind: 'rss', enabled: true, messageTemplate: '{title}', hashtags: '', targetIds: ['t1'], handling: 'review', spreadMinutes: 0, failureCount: 0, lastPolledAt: null, lastError: null, createdAt: '', updatedAt: '' } as Feed;
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ entries: [{ guid: 'g1', title: 'Article', message: '<script>unsafe</script>\nReal caption', link: 'https://example.com/article', isNew: true, eligible: true }], held: 0, draftsCreated: 0, postsCreated: 0 })));
  await act(async () => root.render(createElement(FeedManager, { initialFeeds: [feed], channels: [{ id: 't1', name: 'Channel' }], page: 1, hasMore: false, limits: { maxNameCharacters: 100, maxMessageCharacters: 1000, maxTargets: 10, maxSpreadMinutes: 60 }, locale: 'fr', automaticMinutes: null })));
  await click([...container.querySelectorAll('button')].find(b => b.textContent?.includes('Vérifier'))!);
  expect(document.querySelector('details summary')?.textContent).toBe('Texte de la publication');
  expect(document.querySelector('details p')?.textContent).toContain('<script>unsafe</script>');
  expect(document.querySelector('details script')).toBeNull();
  expect(document.querySelector('details a')?.getAttribute('rel')).toBe('noopener noreferrer');
  expect(container.textContent).toContain('Les publications à valider');
});
it('preserves rename input on failure and accepts a matching receipt', async () => {
  const asset = { id: 'med_1', kind: 'video', mimeType: 'video/mp4', name: 'clip.mp4', size: 100, createdAt: '2026-01-01', source: 'library', inUse: false, holderCount: 0, holders: [], width: null, height: null } as Asset;
  await act(async () => root.render(createElement(MediaLibrary, { items: [asset], usage: { usedBytes: 100, quotaBytes: 1000, assetCount: 1, approximate: false }, page: 1, hasMore: false, filters: { kind: '', usage: '', q: '' }, canWrite: true, workspaceWide: true, usageMayBeIncomplete: false, maxSearch: 100, maxName: 12, locale: 'en' })));
  await click([...container.querySelectorAll('button')].find(b => b.textContent === 'Rename')!);
  const dialog = document.querySelector('dialog')!;
  const inputs = dialog.querySelectorAll('input');
  expect(inputs[0].maxLength).toBe(12);
  await input(inputs[0], 'new.mp4'); await input(inputs[1], 'RENAME MEDIA med_1');
  state.rename.mockResolvedValueOnce({ error: 'Try again' });
  await click([...dialog.querySelectorAll('button')].find(b => b.textContent === 'Rename')!);
  expect(inputs[0].value).toBe('new.mp4'); expect(document.body.textContent).toContain('Try again');
  state.rename.mockResolvedValueOnce({ renamed: true, id: 'med_1', name: 'new.mp4' });
  await click([...dialog.querySelectorAll('button')].find(b => b.textContent === 'Rename')!);
  expect(document.querySelector('dialog')).toBeNull(); expect(container.textContent).toContain('Media renamed.');
  expect(state.rename).toHaveBeenCalledWith({ id: 'med_1', name: 'new.mp4', confirmation: 'RENAME MEDIA med_1' });
});
