// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }) }));

import { InboxTag, inboxKindTone } from '../src/modules/inbox/ui/InboxTags';
import { InboxSyncBar, inboxFreshnessState } from '../src/modules/inbox/ui/InboxActions';
import { InboxCopyProvider } from '../src/modules/inbox/ui/copy-context';
import { ToastProvider } from '../src/components/Toast';
import { inboxCustomerCopy } from '../src/modules/inbox/customer-copy';
import { moderationOutcomeTone } from '../src/modules/inbox/components/ModerationRules';
import { NotificationCenter, notificationEventTone } from '../src/modules/settings/ui/notifications/NotificationCenter';
import { activityOutcomeTone } from '../src/modules/analytics/ui/insights/OverviewCards';
import { adsStatusTone } from '../src/modules/ads/ui/objects/status-tone';
import { agentRunTone } from '../src/modules/studio/agents/ui/status-tone';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null; let host: HTMLElement | null = null;
async function mount(node: import('react').ReactNode) {
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  await act(async () => { root!.render(node); });
}
async function reset() { if (root) await act(async () => root!.unmount()); root = null; host?.remove(); host = null; document.body.innerHTML = ''; }
afterEach(reset);

describe('UI waves 3-4 badge and freshness mapping', () => {
  it('tints private message badges with the accent and keeps comments neutral', () => {
    expect(inboxKindTone('message')).toBe('brand');
    expect(inboxKindTone('comment')).toBe('neutral');
    expect(inboxKindTone('review')).toBe('neutral');
    expect(inboxKindTone('chimera')).toBe('neutral');
    expect(renderToStaticMarkup(h(InboxTag, { icon: 'message', tone: 'brand', children: 'Message' }))).toContain('ui-badge--brand');
  });

  it('derives inbox freshness from the stored read, never from a guess', () => {
    expect(inboxFreshnessState({ lastSynced: null })).toBe('never');
    expect(inboxFreshnessState({ lastSynced: '10:00', stale: true })).toBe('stale');
    expect(inboxFreshnessState({ lastSynced: '10:00', stale: false })).toBe('fresh');
    expect(inboxFreshnessState({ lastSynced: '10:00', stale: true, syncedNow: 'now' })).toBe('fresh');
  });

  it('tones moderation log outcomes by completion', () => {
    expect(moderationOutcomeTone({ error: 'denied', undoneAt: null })).toBe('danger');
    expect(moderationOutcomeTone({ error: null, undoneAt: '2026-10-23' })).toBe('neutral');
    expect(moderationOutcomeTone({ error: null, undoneAt: null })).toBe('success');
  });

  it('tones notification events by kind', () => {
    expect(notificationEventTone('note_mention')).toBe('brand');
    expect(notificationEventTone('inbox_note_mention')).toBe('brand');
    expect(notificationEventTone('metric_alert')).toBe('warning');
    expect(notificationEventTone('report_delivered')).toBe('success');
    expect(notificationEventTone('triage_assigned')).toBe('neutral');
    expect(notificationEventTone('queue_empty')).toBe('neutral');
  });

  it('tones stored ads statuses without knowing provider enums', () => {
    expect(adsStatusTone('ACTIVE')).toBe('success');
    expect(adsStatusTone('active')).toBe('success');
    expect(adsStatusTone('PAUSED')).toBe('neutral');
    expect(adsStatusTone('deleted')).toBe('danger');
    expect(adsStatusTone('DISAPPROVED')).toBe('danger');
    expect(adsStatusTone(null)).toBe('neutral');
    expect(adsStatusTone('SOMETHING_NEW')).toBe('neutral');
  });

  it('tones writing-agent runs by outcome', () => {
    expect(agentRunTone('completed')).toBe('success');
    expect(agentRunTone('failed')).toBe('danger');
    expect(agentRunTone('working')).toBe('neutral');
    expect(agentRunTone('Completed')).toBe('success');
  });

  it('separates planned from published activity', () => {
    expect(activityOutcomeTone('published')).toBe('success');
    expect(activityOutcomeTone('scheduled')).toBe('brand');
    expect(activityOutcomeTone('failed')).toBe('danger');
  });
});

describe('UI waves 3-4 surfaced states', () => {
  it('shows a stale warning badge beside Sync now when the stored read is stale', async () => {
    await mount(h(ToastProvider, { children: h(InboxCopyProvider, { catalog: inboxCustomerCopy, children: h(InboxSyncBar, { lastSynced: '08:00', stale: true }) }) }));
    const badge = host!.querySelector('.ui-badge--warning');
    expect(badge?.textContent).toContain('May be out of date');
    expect(host!.textContent).toContain('Sync now');
  });

  it('shows no stale badge on a fresh stored read', async () => {
    await mount(h(ToastProvider, { children: h(InboxCopyProvider, { catalog: inboxCustomerCopy, children: h(InboxSyncBar, { lastSynced: '08:00', stale: false }) }) }));
    expect(host!.querySelector('.ui-badge--warning')).toBeNull();
  });

  it('renders notification state and event as separate badges with the same words', async () => {
    const row = {
      id: 'row-1', kind: 'metric_alert' as const, createdAt: new Date('2026-10-22T12:00:00Z'), updatedAt: new Date('2026-10-22T12:00:00Z'),
      readAt: null, emailSentAt: null, emailState: 'pending' as const, title: 'Threshold crossed', body: 'Review it.', available: true,
      postId: null, noteId: null, targetId: 'channel-a', labelId: null,
    };
    const preferences = { preferences: { onNoteMention: true, onQueueEmpty: true }, configured: true, mutes: [], channels: [], maxMutes: 4, locale: 'en' as const };
    await mount(h(NotificationCenter, { initialPreferences: preferences, initialPage: { items: [row], page: 1, pageSize: 25, hasMore: false }, locale: 'en' }));
    expect(host!.textContent).toContain('Unread · Metric alert firing');
    const badges = host!.querySelectorAll('.ui-badge--warning');
    expect([...badges].some(badge => badge.textContent === 'Metric alert firing')).toBe(true);
  });
});
