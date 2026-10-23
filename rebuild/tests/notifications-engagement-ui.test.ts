// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NotificationCenter } from '../src/modules/settings/ui/notifications/NotificationCenter';

let root: ReturnType<typeof createRoot>, container: HTMLDivElement;
const row = (kind: 'metric_alert' | 'report_delivered' | 'triage_assigned', title: string) => ({
  id: `row-${kind}`, kind, createdAt: new Date('2026-10-22T12:00:00Z'), updatedAt: new Date('2026-10-22T12:00:00Z'),
  readAt: null, emailSentAt: null, emailState: 'pending' as const, title, body: 'Review it.', available: true,
  postId: null, noteId: null, targetId: 'channel-a', labelId: null,
});
const preferences = {
  preferences: { onNoteMention: true, onQueueEmpty: true, onMetricAlert: true, onReportDelivered: false, onTriageAssigned: true },
  configured: true, mutes: [], channels: [], maxMutes: 4,
};
const page = { items: [row('metric_alert', 'A watched metric crossed its threshold'), row('report_delivered', 'A scheduled report was sent'), row('triage_assigned', 'Inbox items were assigned to you')], page: 1, pageSize: 25, hasMore: false };

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

describe('engagement notification center', () => {
  it('shows firing, delivery and triage alerts with their own family labels', async () => {
    await act(async () => root.render(createElement(NotificationCenter, { initialPreferences: preferences, initialPage: page })));
    expect(container.textContent).toContain('A watched metric crossed its threshold');
    expect(container.textContent).toContain('Unread · Metric alert firing');
    expect(container.textContent).toContain('Unread · Scheduled report sent');
    expect(container.textContent).toContain('Unread · Inbox triage assignment');
  });

  it('offers email switches for the new events', async () => {
    await act(async () => root.render(createElement(NotificationCenter, { initialPreferences: preferences, initialPage: page })));
    expect(container.textContent).toContain('Metric alert firings');
    expect(container.textContent).toContain('Scheduled report deliveries');
    expect(container.textContent).toContain('Inbox items assigned to you');
  });

  it('labels the new families in French', async () => {
    await act(async () => root.render(createElement(NotificationCenter, { initialPreferences: { ...preferences, locale: 'fr' }, initialPage: page, locale: 'fr' })));
    expect(container.textContent).toContain('Non lue · Déclenchement d’alerte de mesure');
    expect(container.textContent).toContain('Non lue · Rapport planifié envoyé');
    expect(container.textContent).toContain('Non lue · Assignation pour triage');
  });
});
