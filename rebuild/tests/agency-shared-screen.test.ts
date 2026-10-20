import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';
import type { AgencyOverview } from '@/modules/agency/agency';
const m = vi.hoisted(() => ({ overview: vi.fn() }));
vi.mock('next/headers', () => ({ headers: async () => new Headers({ 'accept-language': 'en' }) }));
vi.mock('@/server/context', () => ({ requireViewer: async () => ({ user: { id: 'person' } }) }));
vi.mock('@/modules/agency/server/agency', () => ({ agencySearchLimit: async () => 40, agencyOverview: m.overview }));
import AgencyScreen from '@/modules/agency/ui/AgencyScreen';
const coverage = { channels: { covered: 1, of: 1 }, publishing: { covered: 1, of: 1 }, tasks: { covered: 0, of: 1 }, team: { covered: 1, of: 1 } };
const overview: AgencyOverview = {
  ok: true, windowDays: 14, limit: 50, truncated: false, filtered: false,
  totals: { workspaces: 1, needingAttention: 1, channels: 3, disconnected: 1, scheduled: 4, failed: 2, openTasks: null, overdueTasks: null, coverage },
  workspaces: [{ id: 'studio', name: 'Studio client', role: 'owner', state: 'available', needsAttention: true, metrics: { channels: 3, disconnected: 1, scheduled: 4, failed: 2, openTasks: null, overdueTasks: null, members: 2, clients: 1 } }],
};
beforeEach(() => { vi.clearAllMocks(); m.overview.mockResolvedValue(overview); });
it('renders shared phone-card tables, module metrics, an honest comparison chart and withheld-data explanations', async () => {
  const html = renderToStaticMarkup(await AgencyScreen({ searchParams: Promise.resolve({}) }));
  expect(html).toContain('ui-page-header__chip'); expect(html).toContain('ui-table--stack'); expect(html).toContain('Studio client');
  expect(html.match(/class="ui-metric"/g)).toHaveLength(6);
  expect(html).toContain('Counted in 0 of 1 workspaces'); expect(html).toContain('Not shown for workspaces where you lack access');
  expect(html).toContain('Scheduled posts · Failed posts'); expect(html).toContain('Needs attention');
});
it('offers a workspace next action and icon when there are no administered workspaces', async () => {
  m.overview.mockResolvedValue({ ...overview, totals: { ...overview.totals, workspaces: 0 }, workspaces: [] });
  const html = renderToStaticMarkup(await AgencyScreen({ searchParams: Promise.resolve({}) }));
  expect(html).toContain('ui-state__icon'); expect(html).toContain('href="/settings/workspace"'); expect(html).not.toContain('class="ui-metric"');
});
