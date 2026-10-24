import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ language: 'en', read: vi.fn() }));
vi.mock('next/headers', () => ({ headers: async () => new Headers({ 'accept-language': state.language }) }));
vi.mock('@/server/config/access', () => ({ requireRootPage: async () => ({ id: 'root' }) }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: async () => { throw new Error('Use safe catalog fallback'); } }));
vi.mock('@/modules/root/server/operator-monitoring', () => ({ readRootOperatorMonitoring: state.read }));
vi.mock('@/modules/root/ui/MonitoringAction', () => ({ MonitoringAction: ({ copy }: { copy: { evaluate: string } }) => React.createElement('button', {}, copy.evaluate) }));
import { RootMonitoring } from '../src/modules/root/ui/RootMonitoring';
beforeEach(() => { state.language = 'en'; state.read.mockResolvedValue({ alerts: [], incidentHistory: [{ id: 'old', key: 'worker.down', openedAt: '2026-10-22T09:00:00Z', resolvedAt: '2026-10-22T09:05:00Z' }], uptime: [{ day: '2026-10-22', component: 'app', minutes: 1 }], deliveries: [{ id: 'receipt', key: 'worker.down', state: 'open', status: 'uncertain', createdAt: '2026-10-22T10:00:00Z', finishedAt: null }], confirmation: 'EVALUATE ROOT MONITORING' }); });
describe('Root monitoring evidence screen', () => {
  it('exposes uncertain deliveries and sampled availability without implying continuous uptime', async () => {
    const html = renderToStaticMarkup(await RootMonitoring());
    expect(html).toContain('Uncertain · review externally');
    expect(html).toContain('never automatically sent again');
    expect(html).toContain('not guaranteed continuous uptime');
    expect(html).toContain('Observed minutes');
    expect(html).toContain('No open alerts in this result.');
    expect(html).toContain('Incident history');
    expect(html).toContain('2026-10-22T09:05:00Z');
  });
  it('renders French labels and useful failure recovery', async () => {
    state.language = 'fr';
    expect(renderToStaticMarkup(await RootMonitoring())).toContain('Incertain · vérification externe');
    state.read.mockRejectedValueOnce(new Error('private details'));
    const html = renderToStaticMarkup(await RootMonitoring());
    expect(html).toContain('Actualisez cette page');
    expect(html).not.toContain('private details');
  });
});
