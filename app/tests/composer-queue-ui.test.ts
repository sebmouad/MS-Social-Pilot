// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ preview: vi.fn(), save: vi.fn(), push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: h.push, back: vi.fn() }) }));
vi.mock('@/modules/publishing/ui/compose/queue-actions', () => ({ previewQueueAction: h.preview, saveQueueComposerAction: h.save }));
vi.mock('@/modules/publishing/ui/posts/actions', () => ({ createPostWithRecoveryAction: vi.fn() }));
import { composerCatalogDefaults, type ComposerCatalog } from '@/modules/publishing/composer-catalog';
import { PostComposer } from '@/modules/publishing/ui/compose/PostComposer';
import { ContentProvider } from '@/modules/publishing/ui/ContentProvider';
import { contentCopyDefaults, contentPolicyDefaults, resolveContentCopy } from '@/modules/publishing/ui/content-copy';
let root: ReturnType<typeof createRoot>, container: HTMLDivElement;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  h.preview.mockResolvedValue({ status: 'ready', scheduledAt: '2026-10-23T10:00:00Z', scheduledLabel: 'Oct 23, 2026, 10:00 AM', channels: [{ targetId: 'a', nextAt: '2026-10-23T10:00:00Z' }] });
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
async function render(locale: 'en' | 'fr' = 'en', queueAvailable = true, copyCatalog?: ComposerCatalog, content = resolveContentCopy(contentCopyDefaults as never, locale)) {
  await act(async () => root.render(createElement(ContentProvider, { copy: content, policy: contentPolicyDefaults, locale }, createElement(PostComposer, {
    copyCatalog, targets: [{ id: 'a', name: 'Studio channel', type: 'channel', provider: null, canPublish: true }], queueAvailable, aiLocale: locale,
    imageRules: { allowedMimeTypes: [], maxUploadBytes: 5000, maxAltCharacters: 120, maxMessageCharacters: 500, maxMedia: 2 },
    schedule: { date: '', time: '', timeZone: 'UTC' }, authorName: 'Team', createdAt: new Date('2026-10-20T00:00:00Z'), createdAtDisplay: 'Oct 20', maxFirstCommentDelayMinutes: 10080,
  }))));
}
async function select() {
  const chip = Array.from(container.querySelectorAll<HTMLButtonElement>('button[aria-pressed]')).find(button => button.textContent?.includes('Studio channel'))!;
  await act(async () => chip.click());
  await act(async () => new Promise(resolve => setTimeout(resolve, 280)));
}
const openMenu = async () => act(async () => container.querySelector<HTMLButtonElement>('.ui-split__menu button, .ui-split .ui-menu__trigger')!.click());
const menuItems = () => Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'));
const queueItem = () => menuItems().find(item => /queue|file/i.test(item.textContent ?? ''));
it('shows the chosen time before enabling queue save, and retains content and retry identity on failure', async () => {
  await render();
  await openMenu();
  expect(queueItem()?.getAttribute('aria-disabled')).toBe('true');
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  await select();
  await openMenu();
  expect(queueItem()?.textContent).toBe('Add to queue · Oct 23, 2026, 10:00 AM');
  expect(queueItem()?.getAttribute('aria-disabled')).not.toBe('true');
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  const message = container.querySelector<HTMLTextAreaElement>('#composer-message')!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(message, 'Retain this post'); message.dispatchEvent(new Event('input', { bubbles: true })); });
  h.save.mockResolvedValueOnce({ status: 'error', message: 'Saved as a draft', values: { draftPostId: 'p1' } });
  await openMenu();
  await act(async () => queueItem()!.click());
  expect(message.value).toBe('Retain this post');
  expect(h.push).not.toHaveBeenCalled();
  await act(async () => new Promise(resolve => setTimeout(resolve, 280)));
  h.save.mockResolvedValueOnce({ status: 'success', destination: '/content?notice=scheduled', values: {}, queued: { scheduledAt: '2026-10-23T10:00:00Z', scheduledLabel: 'Oct 23, 2026, 10:00 AM', status: 'pending_approval' } });
  await openMenu();
  await act(async () => queueItem()!.click());
  expect((h.save.mock.calls[1]![1] as FormData).get('intent')).toBe('queue');
  expect(h.save.mock.calls[1]![0].values.draftPostId).toBe('p1');
  expect(container.textContent).toContain('still needs approval');
  expect(h.push).toHaveBeenCalledOnce();
});
it('blocks a full queue and uses French queue copy', async () => {
  h.preview.mockResolvedValue({ status: 'full', channels: [{ targetId: 'a', nextAt: null }] });
  await render('fr'); await select(); await openMenu();
  expect(queueItem()?.textContent).toBe('Ajouter à la file (aucun créneau libre)');
  expect(queueItem()?.getAttribute('aria-disabled')).toBe('true');
});
it('offers a retry when queue times cannot be checked, and hides queue without permission', async () => {
  h.preview.mockRejectedValue(new Error('offline'));
  await render(); await select(); await openMenu();
  expect(queueItem()?.textContent).toMatch(/could not be checked/);
  const calls = h.preview.mock.calls.length;
  await act(async () => queueItem()!.click());
  await act(async () => new Promise(resolve => setTimeout(resolve, 280)));
  expect(h.preview.mock.calls.length).toBeGreaterThan(calls);
  await act(async () => root.unmount());
  root = createRoot(container);
  await render('en', false);
  await openMenu();
  expect(queueItem()).toBeUndefined();
  expect(menuItems().map(item => item.textContent)).toEqual(['Publish now', 'Schedule…']);
});

it('renders edited Root Create copy in French', async () => {
  const content = resolveContentCopy(contentCopyDefaults as never, 'fr');
  content.createSaveDraft = 'Conserver maintenant';
  content.createText = 'Texte personnalisé';
  await render('fr', true, structuredClone(composerCatalogDefaults), content);
  expect(container.textContent).toContain('Texte personnalisé');
  expect(Array.from(container.querySelectorAll('button')).some(button => button.textContent === 'Conserver maintenant')).toBe(true);
});
