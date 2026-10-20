import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ viewer: vi.fn(), selectedTargets: vi.fn(), permitted: vi.fn(), overview: vi.fn(), locale: vi.fn() }));
vi.mock('../src/server/context', () => ({ requireViewer: state.viewer }));
vi.mock('../src/server/PageFrame', () => ({ PageFrame: ({ children }: { children: unknown }) => children }));
vi.mock('../src/server/entitlements', () => ({ canUseFeature: () => true, entitledPlatformIds: (value: { platformCapabilities: Record<string, boolean> }) => Object.keys(value.platformCapabilities).filter(id => value.platformCapabilities[id]) }));
vi.mock('../src/server/permissions', () => ({ canAccessFeature: state.permitted }));
vi.mock('../src/server/data', () => ({ getTargets: state.selectedTargets }));
vi.mock('../src/modules/home/server/overview', () => ({ readHomeOverview: state.overview }));
vi.mock('../src/modules/home/auth/locale', () => ({ authLocale: state.locale }));
vi.mock('@/components/charts', () => {
  const stub = (name: string) => ({ label }: { label: string }) => `[${name}:${label}]`;
  return { BarChart: stub('bar'), DonutChart: stub('donut'), HeatmapChart: stub('heatmap'), Sparkline: stub('spark') };
});
import HomePage from '../src/modules/home/ui/HomeScreen';

const workspaceId = 'workspace-a';
const totals = (current: number | null, change: number | null) => ({ current, previous: current, change, covered: 2, comparable: 2 });
const full = () => ({
  generatedAt: '2026-10-20T12:00:00.000Z', lookbackDays: 28, timeZone: 'UTC', channelCount: 2,
  audience: { state: 'ready', data: { total: 12345, covered: 2, selected: 3, asOf: '2026-10-19T00:00:00.000Z', trend: [{ t: '2026-10-18', v: 1 }, { t: '2026-10-19', v: 2 }] } },
  performance: { state: 'ready', data: { views: totals(5000, 0.25), engagements: totals(300, -0.1), channels: 2, truncated: false,
    topChannels: [{ id: 'c1', name: 'Alpha', engagements: 200 }], interactions: [{ key: 'reactions', label: 'Reactions', value: 10 }] } },
  bestTimes: { state: 'ready', data: { cells: [{ day: 1, hour: 9, value: 1.4, posts: 3 }], measuredPosts: 12 } },
  upcoming: { state: 'ready', data: { total: 3, items: [
    { id: 'p1', text: 'Launch day', scheduledAt: '2026-10-21T09:00:00.000Z', channels: ['Alpha'], mode: 'platform' },
    { id: 'p2', text: 'Recap', scheduledAt: '2026-10-22T09:00:00.000Z', channels: ['Beta'], mode: 'app' }] } },
  inbox: { state: 'ready', data: { open: 7 } },
  ads: { state: 'ready', data: { spend: [{ currency: 'EUR', total: 250, daily: [{ t: '2026-10-18', v: 100 }, { t: '2026-10-19', v: 150 }] }] } },
});

beforeEach(() => {
  vi.resetAllMocks();
  state.viewer.mockResolvedValue({ user: { id: 'owner' }, workspaceId, membership: { workspace: { name: 'Example workspace' } }, entitlements: { platformCapabilities: { facebook: true } }, permissions: { pageScope: { all: true, ids: [] } } });
  state.selectedTargets.mockResolvedValue([{ id: 'channel-0' }]);
  state.permitted.mockReturnValue(true);
  state.locale.mockResolvedValue('en');
  state.overview.mockResolvedValue(full());
});

describe('Home overview screen', () => {
  it('reads the overview as the current member and renders every card with its module link', async () => {
    const html = renderToStaticMarkup(await HomePage());
    expect(state.overview).toHaveBeenCalledWith({ userId: 'owner', workspaceId });
    expect(html).toContain('12,345');
    expect(html).toContain('5,000');
    expect(html).toContain('+25% vs the previous 28 days');
    expect(html).toContain('−10% vs the previous 28 days');
    expect(html).toContain('[bar:Engagements by channel, last 28 days]');
    expect(html).toContain('[donut:Interactions by type, last 28 days]');
    expect(html).toContain('[heatmap:Typical engagement by weekday and hour]');
    expect(html).toContain('Held on the platform');
    expect(html).toContain('Sent by the app');
    expect(html).toContain('€250.00');
    for (const href of ['/analytics', '/publishing/posts', '/inbox', '/ads']) expect(html).toContain(`href="${href}"`);
    expect(html).toContain('Welcome back, Example workspace');
    expect(html).toContain('Last 28 days');
  });

  it('only shows cards for modules the member can use', async () => {
    state.overview.mockResolvedValue({ ...full(), audience: null, performance: null, bestTimes: null, inbox: null, ads: null });
    const html = renderToStaticMarkup(await HomePage());
    expect(html).not.toContain('href="/ads"');
    expect(html).not.toContain('href="/inbox"');
    expect(html).not.toContain('href="/analytics"');
    expect(html).toContain('Launch day');
  });

  it('invites the next action when a card has nothing to show', async () => {
    state.overview.mockResolvedValue({ ...full(), audience: { state: 'empty' }, upcoming: { state: 'empty' }, bestTimes: { state: 'empty' }, ads: { state: 'empty' } });
    const html = renderToStaticMarkup(await HomePage());
    expect(html).toContain('No audience counts yet');
    expect(html).toContain('Nothing scheduled');
    expect(html).toContain('href="/publishing/compose"');
    expect(html).toContain('Not enough history yet');
    expect(html).toContain('No ad spend yet');
  });

  it('shows a calm unavailable state for one failed card and keeps the rest', async () => {
    state.overview.mockResolvedValue({ ...full(), inbox: { state: 'unavailable' } });
    const html = renderToStaticMarkup(await HomePage());
    expect(html).toContain('Not available right now');
    expect(html).toContain('12,345');
  });

  it('never presents an unknown figure as zero', async () => {
    state.overview.mockResolvedValue({ ...full(), performance: { state: 'ready', data: { views: totals(null, null), engagements: totals(null, null), channels: 2, truncated: false, topChannels: [], interactions: [] } } });
    const html = renderToStaticMarkup(await HomePage());
    expect(html).toContain('Not available');
    expect(html).toContain('No comparison yet');
    expect(html).toContain('No channel has engagement figures yet.');
  });

  it('renders French copy and the connect prompt when no channel is selected', async () => {
    state.locale.mockResolvedValue('fr');
    state.selectedTargets.mockResolvedValue([]);
    const html = renderToStaticMarkup(await HomePage());
    expect(html).toContain('Bon retour');
    expect(html).toContain('Connecter des canaux');
    expect(html).toContain('Conservée sur la plateforme');
    expect(state.selectedTargets).toHaveBeenCalledWith(workspaceId, undefined, ['facebook']);
  });

  it('uses the member channel scope for the connect prompt check', async () => {
    state.viewer.mockResolvedValue({ user: { id: 'member' }, workspaceId, membership: { workspace: { name: 'Example workspace' } }, entitlements: { platformCapabilities: { facebook: true } }, permissions: { pageScope: { all: false, ids: ['channel-allowed'] } } });
    await HomePage();
    expect(state.selectedTargets).toHaveBeenCalledWith(workspaceId, ['channel-allowed'], ['facebook']);
  });
});
