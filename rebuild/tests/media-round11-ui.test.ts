// @vitest-environment jsdom
import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ rename: vi.fn(), refresh: vi.fn() }));
vi.mock('@/modules/media/ui/rename-action', () => ({ renameMediaAction: state.rename }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: state.refresh }) }));
import { MediaLibrary, type Asset } from '@/modules/media/ui/MediaLibrary';
const asset: Asset = { id: '11111111-2222-4333-8444-555555555555', kind: 'image', mimeType: 'image/jpeg', name: 'Spring.jpg', size: 100, createdAt: '2026-10-21T00:00:00Z', source: 'stored-image', width: null, height: null, inUse: false, holderCount: 0, holders: [] };
let root: ReturnType<typeof createRoot>, container: HTMLDivElement;
const props = { items: [asset], usage: { usedBytes: 100, quotaBytes: 1000, assetCount: 1, approximate: false }, page: 1, hasMore: false, filters: { kind: '', usage: '', q: '' }, canWrite: true, workspaceWide: true, usageMayBeIncomplete: false, maxSearch: 120, maxName: 180 };
const button = (label: string, scope: ParentNode = container) => [...scope.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === label)!;
const fill = async (input: HTMLInputElement, value: string) => act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); });
beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); }; HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  vi.clearAllMocks(); vi.stubGlobal('fetch', vi.fn()); container = document.createElement('div'); document.body.append(container); root = createRoot(container); await act(async () => root.render(createElement(MediaLibrary, props)));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
it('offers image rename and retains failed input until a matching receipt', async () => {
  await act(async () => button('Rename').click()); const dialog = container.querySelector('dialog[open]')!; const inputs = dialog.querySelectorAll('input');
  await fill(inputs[0]!, 'Summer.jpg'); await fill(inputs[1]!, `RENAME MEDIA ${asset.id}`);
  state.rename.mockResolvedValueOnce({ error: 'Refresh and try again.' }); await act(async () => button('Rename', dialog).click());
  expect(inputs[0]!.value).toBe('Summer.jpg'); expect(dialog.hasAttribute('open')).toBe(true); expect(state.refresh).not.toHaveBeenCalled();
  state.rename.mockResolvedValueOnce({ id: asset.id, name: 'Summer.jpg', renamed: true }); await act(async () => button('Rename', dialog).click());
  expect(state.rename).toHaveBeenLastCalledWith({ id: asset.id, name: 'Summer.jpg', confirmation: `RENAME MEDIA ${asset.id}` }); expect(container.textContent).toContain('Summer.jpg'); expect(state.refresh).toHaveBeenCalledOnce();
});
it('hides rename for limited access and exposes French WebP guidance', async () => {
  await act(async () => root.render(createElement(MediaLibrary, { ...props, workspaceWide: false, locale: 'fr' }))); expect(button('Renommer')).toBeUndefined();
  await act(async () => button('Importer depuis une adresse web').click()); expect(container.querySelector('dialog[open]')!.textContent).toContain('Les images WebP fixes sont enregistrées au format PNG');
});
it('updates visible names after server refresh without remounting', async () => {
  await act(async () => root.render(createElement(MediaLibrary, { ...props, items: [{ ...asset, name: 'Retained.jpg' }] }))); expect(container.textContent).toContain('Retained.jpg'); expect(container.textContent).not.toContain('Spring.jpg');
});

it('submits a named WebP through REST and announces conversion only on a confirmed receipt', async () => {
  vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ id: asset.id, converted: true, mimeType: 'image/png' }) } as Response);
  await act(async () => button('Import from web address').click());
  const dialog = container.querySelector('dialog[open]')!, inputs = dialog.querySelectorAll('input');
  const url = 'https://example.com/spring.webp';
  await fill(inputs[0]!, url); await fill(inputs[1]!, 'Spring.webp'); await fill(inputs[2]!, `IMPORT MEDIA ${url}`);
  await act(async () => button('Import', dialog).click());
  expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0]![1]!.body))).toEqual({ url, name: 'Spring.webp', confirmation: `IMPORT MEDIA ${url}` });
  expect(container.textContent).toContain('The WebP image was saved as PNG.'); expect(state.refresh).toHaveBeenCalledOnce();
});
