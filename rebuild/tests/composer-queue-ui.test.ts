// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ preview: vi.fn(), save: vi.fn(), push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: h.push }) }));
vi.mock('@/modules/publishing/ui/compose/queue-actions', () => ({ previewQueueAction: h.preview, saveQueueComposerAction: h.save }));
vi.mock('@/modules/publishing/ui/posts/actions', () => ({ createPostWithRecoveryAction: vi.fn() }));
import { composerCatalogDefaults, type ComposerCatalog } from '@/modules/publishing/composer-catalog';
import { PostComposer } from '@/modules/publishing/ui/compose/PostComposer';
import { SidebarDockContext } from '@/components/SidebarDock';
let root: ReturnType<typeof createRoot>, container: HTMLDivElement, dock: HTMLDivElement;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  container = document.createElement('div'); dock = document.createElement('div'); document.body.append(container, dock); root = createRoot(container);
  h.preview.mockResolvedValue({ status: 'ready', scheduledAt: '2026-10-23T10:00:00Z', channels: [{ targetId: 'a', nextAt: '2026-10-23T10:00:00Z' }] });
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); dock.remove(); });
async function render(locale: 'en' | 'fr' = 'en', queueAvailable = true, copyCatalog?: ComposerCatalog) {
  await act(async () => root.render(createElement(SidebarDockContext.Provider, { value: dock }, createElement(PostComposer, {
    copyCatalog, targets: [{ id: 'a', name: 'Studio channel', type: 'channel', provider: null, canPublish: true }], queueAvailable, aiLocale: locale,
    imageRules: { allowedMimeTypes: [], maxUploadBytes: 5000, maxAltCharacters: 120, maxMessageCharacters: 500, maxMedia: 2 },
    schedule: { date: '', time: '', timeZone: 'UTC' }, authorName: 'Team', createdAt: new Date('2026-10-20T00:00:00Z'), createdAtDisplay: 'Oct 20', maxFirstCommentDelayMinutes: 10080,
  }))));
}
async function select() {
  await act(async () => dock.querySelector<HTMLInputElement>('[name="targetIds"]')!.click());
  await act(async () => new Promise(resolve => setTimeout(resolve, 280)));
}
const queueButton = () => dock.querySelector<HTMLButtonElement>('button[value="queue"]')!;
it('shows the chosen time before enabling queue save, and retains content and retry identity on failure', async () => {
  await render();
  expect(queueButton().disabled).toBe(true);
  await select();
  expect(dock.textContent).toContain('Next queue time:');
  expect(queueButton().disabled).toBe(false);
  const message = container.querySelector<HTMLTextAreaElement>('#composer-message')!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(message, 'Retain this post'); message.dispatchEvent(new Event('input', { bubbles: true })); });
  h.save.mockResolvedValueOnce({ status: 'error', message: 'Saved as a draft', values: { draftPostId: 'p1' } });
  await act(async () => queueButton().click());
  expect(message.value).toBe('Retain this post');
  expect(h.push).not.toHaveBeenCalled();
  await act(async () => new Promise(resolve => setTimeout(resolve, 280)));
  h.save.mockResolvedValueOnce({ status: 'success', destination: '/publishing/posts?notice=scheduled', values: {}, queued: { scheduledAt: '2026-10-23T10:00:00Z', status: 'pending_approval' } });
  await act(async () => queueButton().click());
  expect(h.save.mock.calls[1]![0].values.draftPostId).toBe('p1');
  expect(container.textContent).toContain('still needs approval');
  expect(h.push).toHaveBeenCalledOnce();
});
it('blocks a full queue and uses French queue copy', async () => {
  h.preview.mockResolvedValue({ status: 'full', channels: [{ targetId: 'a', nextAt: null }] });
  await render('fr'); await select();
  expect(queueButton().textContent).toBe('Ajouter à la file');
  expect(dock.textContent).toContain('Aucun créneau libre');
  expect(queueButton().disabled).toBe(true);
});
it('blocks unavailable previews and hides queue without permission', async () => {
  h.preview.mockRejectedValue(new Error('offline'));
  await render(); await select();
  expect(queueButton().disabled).toBe(true);
  await render('en', false);
  expect(queueButton()).toBeNull();
});

it('renders edited Root composer labels and queue actions in French', async () => {
  const catalog = structuredClone(composerCatalogDefaults);
  catalog.ui_postText.fr = 'Texte personnalisé ';
  catalog.ui_saveDraft.fr = 'Conserver maintenant';
  catalog.queue_button.fr = 'Créneau personnalisé';
  await render('fr', true, catalog);
  expect(container.querySelector('label[for="composer-message"]')?.textContent).toContain('Texte personnalisé');
  expect(dock.querySelector('button[value="draft"]')?.textContent).toBe('Conserver maintenant');
  expect(queueButton().textContent).toBe('Créneau personnalisé');
});
