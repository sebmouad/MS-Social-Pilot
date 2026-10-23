// @vitest-environment jsdom
import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('../src/modules/inbox/ui/inbox.module.css', () => ({ default: {} }));
vi.mock('../src/components', async () => ({ ...await import('../src/components/Button'), InfoTip: ({ children }: { children?: ReactNode }) => createElement('span', null, children) }));

import { InboxSyncBar } from '../src/modules/inbox/ui/InboxActions';
import { inboxCustomerCopy, resolveInboxCatalog } from '../src/modules/inbox/customer-copy';
import { inboxSyncStale } from '../src/modules/inbox/server/freshness';

let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

async function render(element: React.ReactNode) { await act(async () => root.render(createElement(() => element))); }

describe('inbox sync freshness', () => {
  const threshold = 60;
  const at = '2026-10-23T12:00:00.000Z';
  it.each([
    ['never synced', null, false],
    ['just synced', new Date('2026-10-23T11:59:00.000Z'), false],
    ['at the threshold', new Date('2026-10-23T11:00:00.000Z'), false],
    ['past the threshold', new Date('2026-10-23T10:59:59.000Z'), true],
  ])('%s', (_name, lastSynced, stale) => {
    expect(inboxSyncStale(lastSynced, threshold, new Date(at))).toBe(stale);
  });

  it('never reports stale for an unusable threshold', () => {
    expect(inboxSyncStale(new Date('2020-01-01T00:00:00.000Z'), 0, new Date(at))).toBe(false);
    expect(inboxSyncStale(new Date('2020-01-01T00:00:00.000Z'), Number.NaN, new Date(at))).toBe(false);
  });
});

describe('inbox sync bar freshness states', () => {
  it('shows the stored time without a stale note while fresh', async () => {
    await render(createElement(InboxSyncBar, { lastSynced: '12:00', stale: false }));
    expect(container.textContent).toContain('Last synced');
    expect(container.textContent).toContain('12:00');
    expect(container.textContent).not.toContain('May be out of date');
  });

  it('says plainly when stored messages may be out of date', async () => {
    await render(createElement(InboxSyncBar, { lastSynced: '09:00', stale: true }));
    expect(container.textContent).toContain('09:00');
    expect(container.textContent).toContain('May be out of date');
  });

  it('says plainly when nothing was ever synced, in French too', async () => {
    await render(createElement(InboxSyncBar, { lastSynced: null, stale: false, locale: 'fr' }));
    expect(container.textContent).toContain('Pas encore synchronisé');
    await render(createElement(InboxSyncBar, { lastSynced: '09:00', stale: true, locale: 'fr' }));
    expect(container.textContent).toContain('Peut ne pas être à jour');
  });

  it('drops the stale note after a sync completes in this session', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true, conversationCount: 1, messageCount: 2, commentCount: 0, targetCount: 1, failedCount: 0, syncedAt: '2026-10-23T12:00:00.000Z', syncedLabel: 'just now' }) })));
    await render(createElement(InboxSyncBar, { lastSynced: '09:00', stale: true }));
    expect(container.textContent).toContain('May be out of date');
    await act(async () => { container.querySelector('button')!.click(); await Promise.resolve(); });
    // The sync action resolves asynchronously; the stale note clears with the fresh label.
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    expect(container.textContent).toContain('just now');
    expect(container.textContent).not.toContain('May be out of date');
  });

  it('keeps the stale note editable through the owning Root catalog', () => {
    expect(inboxCustomerCopy['actionCopy.staleNote']).toEqual({ en: 'May be out of date', fr: 'Peut ne pas être à jour' });
    const overridden = resolveInboxCatalog('actionCopy', { ...inboxCustomerCopy, 'actionCopy.staleNote': { en: 'Custom stale', fr: 'Custom périmé' } });
    expect(overridden.en.staleNote).toBe('Custom stale');
    expect(overridden.fr.staleNote).toBe('Custom périmé');
  });
});
