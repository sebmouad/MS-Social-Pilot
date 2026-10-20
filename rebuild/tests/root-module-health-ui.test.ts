import { beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
const state = vi.hoisted(() => ({ language: 'en', load: vi.fn() }));
vi.mock('next/headers', () => ({ headers: async () => new Headers({ 'accept-language': state.language }) }));
vi.mock('../src/server/config/access', () => ({ requireRootPage: async () => ({ id: 'root' }) }));
vi.mock('../src/server/root/module-health', () => ({ loadRootModuleHealth: state.load }));
import { ModuleHealth } from '../src/app/root/modules/ModuleHealth';
beforeEach(() => { state.language = 'en'; state.load.mockResolvedValue({ id: 'audit', checkedAt: '2026-10-20T00:00:00Z', durationMs: 1, modules: [{ id: 'product:inbox', kind: 'product', title: 'Inbox', status: 'unknown', durationMs: 1, configuration: [], jobs: [], queues: [{ name: 'scheduledPosts', count: null, status: 'unknown' }] }] }); });
it('renders grouped unknown evidence and audit without fabricating zero counts', async () => {
  const html = renderToStaticMarkup(await ModuleHealth({}));
  expect(html).toContain('Product modules'); expect(html).toContain('Not available'); expect(html).toContain('Unknown'); expect(html).toContain('/root/activity'); expect(html).not.toContain('Due scheduled posts: 0');
  expect(state.load).toHaveBeenCalledWith('root', undefined);
});
it('renders French and passes the exact installed scope to the shared service', async () => {
  state.language = 'fr';
  const html = renderToStaticMarkup(await ModuleHealth({ scope: 'product:inbox' }));
  expect(html).toContain('Non disponible'); expect(html).toContain('Modules produit'); expect(state.load).toHaveBeenCalledWith('root', 'product:inbox');
});
it('preserves navigation with a safe localized failure message', async () => {
  state.load.mockRejectedValueOnce(new Error('private database error'));
  const html = renderToStaticMarkup(await ModuleHealth({}));
  expect(html).toContain('role="alert"'); expect(html).not.toContain('private database error');
});
