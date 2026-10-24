// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { NotificationCenter, notificationHref } from '../src/modules/settings/ui/notifications/NotificationCenter';
import { HierarchyTable } from '../src/modules/ads/ui/campaigns/HierarchyTable';
import { ToastProvider } from '../src/components/Toast';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
beforeEach(() => { container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

describe('notification deep links', () => {
  const base = { id: 'n1', createdAt: new Date(), updatedAt: new Date(), readAt: null, emailSentAt: null, emailState: 'pending' as const, title: 'T', body: 'B', available: true, postId: null, noteId: null, targetId: null, labelId: null };
  it('maps each kind to its destination', () => {
    expect(notificationHref({ ...base, kind: 'note_mention', postId: 'post-1', noteId: 'note-1' })).toBe('/content/post/post-1');
    expect(notificationHref({ ...base, kind: 'publish_failure', postId: 'post-2' })).toBe('/content/post/post-2');
    expect(notificationHref({ ...base, kind: 'connection_expired' })).toBe('/settings/channels');
    expect(notificationHref({ ...base, kind: 'metric_alert' })).toBe('/insights/reports');
    expect(notificationHref({ ...base, kind: 'triage_assigned' })).toBe('/tasks');
    expect(notificationHref({ ...base, kind: 'queue_empty', targetId: 'channel-a' })).toBe('/content?channel=channel-a');
    expect(notificationHref({ ...base, kind: 'inbox_digest', targetId: 'channel-a' })).toBe('/inbox?channel=channel-a');
  });
  it('links nothing without a safe destination', () => {
    expect(notificationHref({ ...base, kind: 'mix_dry' })).toBeNull();
    expect(notificationHref({ ...base, kind: 'note_mention', postId: 'post-1/../../x', noteId: 'n' })).toBeNull();
    expect(notificationHref({ ...base, kind: 'inbox_digest', targetId: null })).toBeNull();
  });
  it('renders the notification title as a link', async () => {
    const item = { ...base, kind: 'note_mention' as const, title: 'Mentioned you', postId: 'post-9', noteId: 'note-3' };
    const preferences = { preferences: { onNoteMention: true, onQueueEmpty: true }, configured: true, mutes: [], channels: [], maxMutes: 4 };
    await act(async () => root.render(createElement(NotificationCenter, { initialPreferences: preferences as never, initialPage: { items: [item], page: 1, pageSize: 25, hasMore: false } as never, locale: 'en' })));
    expect(container.querySelector('a[href="/content/post/post-9"]')?.textContent).toContain('Mentioned you');
  });
});

describe('ads hierarchy names', () => {
  const row = { key: 'c1', id: 'remote-1', name: 'Spring', level: 'campaign' as const, currency: 'USD', spend: 10, impressions: 100, clicks: 5, ctr: 5, cpc: 2, days: 3, spendSeries: [5, 5] };
  it('links the object name to the filtered manager', () => {
    const html = renderToStaticMarkup(createElement(ToastProvider, null, createElement(HierarchyTable, { caption: 'Results', rows: [row], locale: 'en', objectsHref: '/ads/manage' })));
    expect(html).toContain('/ads/manage?level=campaign');
    expect(html).toContain('>Spring<');
  });
  it('keeps plain names without a manager path', () => {
    const html = renderToStaticMarkup(createElement(ToastProvider, null, createElement(HierarchyTable, { caption: 'Results', rows: [row], locale: 'en' })));
    expect(html).not.toContain('<a ');
  });
});
