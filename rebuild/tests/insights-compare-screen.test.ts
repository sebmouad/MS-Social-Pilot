import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const state = vi.hoisted(() => ({ compare: vi.fn(), viewer: vi.fn() }));
vi.mock('next/headers', () => ({ headers: async () => new Headers({ 'accept-language': 'en' }) }));
vi.mock('@/modules/analytics/server/copy', async () => {
  const c = await import('@/modules/analytics/copy');
  return { analyticsCopy: async () => ({ reports: c.reportCopyDefaults, goals: c.goalsCopyDefaults, downloads: c.downloadCopyDefaults, demographics: c.demographicsCopyDefaults, workspace: c.workspaceCopyDefaults, records: c.recordsCopyDefaults, errors: c.errorCopyDefaults }) };
});
vi.mock('@/modules/analytics/comparison/server/comparison', () => ({ readAnalyticsComparison: state.compare }));
vi.mock('../src/server/context', () => ({ requireViewer: state.viewer }));
vi.mock('../src/server/PageFrame', () => ({ PageFrame: ({ children }: { children: import('react').ReactNode }) => createElement('main', null, children) }));

import ComparePage from '../src/modules/analytics/ui/compare/CompareScreen';

const actor = { userId: 'reader-a', workspaceId: 'workspace-a' };
const comparison = (mode: 'period' | 'channels') => ({
  ok: true as const,
  mode,
  periods: { a: { start: '2026-10-01', end: '2026-10-07' }, b: { start: '2026-09-24', end: '2026-09-30' } },
  selected: {
    a: { channelIds: ['a', 'b'], adAccountIds: [] },
    b: { channelIds: mode === 'period' ? ['a', 'b'] : ['c'], adAccountIds: [] },
  },
  audience: {
    a: { total: 10, covered: 2, selected: 2, asOf: null },
    b: { total: 8, covered: 2, selected: 2, asOf: null },
    delta: 2,
    note: 'Audience adds the latest valid figure for each covered channel.',
  },
  metrics: [],
  truncated: false,
  totalMetrics: 0,
  options: { channels: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }] },
});

beforeEach(() => {
  vi.clearAllMocks();
  state.viewer.mockResolvedValue({ user: { id: actor.userId }, workspaceId: actor.workspaceId, entitlements: { features: {} }, permissions: { features: {} } });
});

describe('Compare screen basis', () => {
  it('states both periods and the channel count for a period comparison', async () => {
    state.compare.mockResolvedValue(comparison('period'));
    const tree = await ComparePage({ searchParams: Promise.resolve({ mode: 'period', aStart: '2026-10-01', aEnd: '2026-10-07', bStart: '2026-09-24', bEnd: '2026-09-30', channel: ['a', 'b'] }) });
    const html = renderToStaticMarkup(tree);
    expect(html).toContain('A 2026-10-01 – 2026-10-07');
    expect(html).toContain('B 2026-09-24 – 2026-09-30');
    expect(html).toContain('2 channels');
  });

  it('states both group sizes and the shared period for a channel-group comparison', async () => {
    state.compare.mockResolvedValue(comparison('channels'));
    const tree = await ComparePage({ searchParams: Promise.resolve({ mode: 'channels', start: '2026-10-01', end: '2026-10-07', groupA: ['a', 'b'], groupB: 'c' }) });
    const html = renderToStaticMarkup(tree);
    expect(html).toContain('Group A: 2');
    expect(html).toContain('Group B: 1');
    expect(html).toContain('2026-10-01 – 2026-10-07');
  });
});
