// @vitest-environment jsdom
import { homeCopyCatalogDefaults } from '@/modules/home/copy';
import { writeB7Fixture } from './b7-visual-fixture';
import fixtureStyles from '@/modules/home/ui/home.module.css';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ viewer: vi.fn(), selectedTargets: vi.fn(), permitted: vi.fn(), overview: vi.fn(), locale: vi.fn(), config: vi.fn() }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: state.config }));
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

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/components/charts/Sparkline', () => ({ Sparkline: () => null }));
let root: ReturnType<typeof createRoot> | undefined;
let container: HTMLDivElement | undefined;
async function disclosedMarkup(node: Parameters<typeof renderToStaticMarkup>[0]) {
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => root!.render(node));
  for (const tip of container.querySelectorAll<HTMLButtonElement>('.ui-infotip__trigger')) await act(async () => tip.click());
  return container.innerHTML;
}
afterEach(async () => { if (root) await act(async () => root!.unmount()); container?.remove(); root = undefined; container = undefined; });
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
  ads: { state: 'ready', data: { start: '2026-09-23', end: '2026-10-20', spend: [{ currency: 'EUR', total: 250, firstDay: '2026-10-18', lastDay: '2026-10-19', recordedDays: 2, daily: [{ t: '2026-10-18', v: 100 }, { t: '2026-10-19', v: 150 }] }] } },
});

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.resetAllMocks();
  state.config.mockResolvedValue(homeCopyCatalogDefaults);
  state.viewer.mockResolvedValue({ user: { id: 'owner', name: 'Preview' }, workspaceId, membership: { workspace: { name: 'Example workspace' } }, entitlements: { platformCapabilities: { facebook: true } }, permissions: { pageScope: { all: true, ids: [] } } });
  state.selectedTargets.mockResolvedValue([{ id: 'channel-0' }]);
  state.permitted.mockReturnValue(true);
  state.locale.mockResolvedValue('en');
  state.overview.mockResolvedValue(full());
});

describe('Home overview screen', () => {
  it('renders current Root copy without changing the selected data or links', async () => {
    state.config.mockResolvedValue({ ...homeCopyCatalogDefaults, greeting: { ...homeCopyCatalogDefaults.greeting, en: 'Hello team' }, upcoming: { ...homeCopyCatalogDefaults.upcoming, en: 'Your next posts' } });
    const html = await disclosedMarkup(await HomePage());
    expect(html).toContain('Hello team, Preview');
    expect(html).toContain('Your next posts');
    expect(html).toContain('Launch day');
    expect(state.config).toHaveBeenCalledTimes(1);
  });
  it('reads the overview as the current member and renders every card with its module link', async () => {
    const html = await disclosedMarkup(await HomePage());
    expect(state.overview).toHaveBeenCalledWith({ userId: 'owner', workspaceId });
    expect(html).toContain('12,345');
    expect(html).toContain('5,000');
    expect(html).toContain('<strong>+25%</strong><span>vs the previous 28 days</span>');
    expect(html).toContain('<strong>−10%</strong><span>vs the previous 28 days</span>');
    expect(html).toContain('ui-metric__delta is-good');
    expect(html).toContain('ui-metric__delta is-bad');
    expect(html).not.toContain('[bar:');
    expect(html).not.toContain('[donut:');
    expect(html).toContain('[heatmap:Typical engagement by weekday and hour]');
    expect(html).toContain('Held on the platform');
    expect(html).toContain('Sent by the app');
    expect(html).toContain('EUR');
    expect(html).toContain('250.00');
    for (const href of ['/insights', '/content', '/inbox', '/insights/ads']) expect(html).toContain(`href="${href}"`);
    expect(html).toContain('Welcome back, Preview');
    expect(html).toContain('Last 28 days');
  });

  it('only shows cards for modules the member can use', async () => {
    state.overview.mockResolvedValue({ ...full(), audience: null, performance: null, bestTimes: null, inbox: null, ads: null });
    const html = await disclosedMarkup(await HomePage());
    expect(html).not.toContain('href="/insights/ads"');
    expect(html).not.toContain('href="/inbox"');
    expect(html).not.toContain('href="/insights"');
    expect(html).toContain('Launch day');
  });

  it('invites the next action when a card has nothing to show', async () => {
    state.overview.mockResolvedValue({ ...full(), audience: { state: 'empty' }, upcoming: { state: 'empty' }, bestTimes: { state: 'empty' }, ads: { state: 'empty' } });
    const html = await disclosedMarkup(await HomePage());
    expect(html).toContain('No audience counts yet');
    expect(html).toContain('Nothing scheduled');
    expect(html).toContain('href="/create"');
    expect(html).toContain('Not enough history yet');
    expect(html).toContain('No ad spend yet');
  });

  it('shows a calm unavailable state for one failed card and keeps the rest', async () => {
    state.overview.mockResolvedValue({ ...full(), inbox: { state: 'unavailable' } });
    const html = await disclosedMarkup(await HomePage());
    expect(html).toContain('Not available right now');
    expect(html).toContain('12,345');
  });

  it('never presents an unknown figure as zero', async () => {
    state.overview.mockResolvedValue({ ...full(), performance: { state: 'ready', data: { views: totals(null, null), engagements: totals(null, null), channels: 2, truncated: false, topChannels: [], interactions: [] } } });
    const html = await disclosedMarkup(await HomePage());
    expect(html).toContain('Not available');
    expect(html).toContain('No comparison yet');
    expect(html).toContain('aria-label="About Views"');
  });

  it('renders French copy and the connect prompt when no channel is selected', async () => {
    state.locale.mockResolvedValue('fr');
    state.selectedTargets.mockResolvedValue([]);
    const html = await disclosedMarkup(await HomePage());
    expect(html).toContain('Bon retour');
    expect(html).toContain('Connecter des canaux');
    expect(html).not.toContain('Launch day');
    expect(state.overview).not.toHaveBeenCalled();
    expect(state.selectedTargets).toHaveBeenCalledWith(workspaceId, undefined, ['facebook']);
  });

  it('uses the member channel scope for the connect prompt check', async () => {
    state.viewer.mockResolvedValue({ user: { id: 'member' }, workspaceId, membership: { workspace: { name: 'Example workspace' } }, entitlements: { platformCapabilities: { facebook: true } }, permissions: { pageScope: { all: false, ids: ['channel-allowed'] } } });
    await HomePage();
    expect(state.selectedTargets).toHaveBeenCalledWith(workspaceId, ['channel-allowed'], ['facebook']);
  });

  it.each(['en', 'fr'])('labels USD and the actual stored-data period in %s', async locale => {
    state.locale.mockResolvedValue(locale);
    const data = full();
    data.ads.data.spend[0] = { currency: 'USD', total: 13, firstDay: '2026-10-15', lastDay: '2026-10-16', recordedDays: 2, daily: [] };
    state.overview.mockResolvedValue(data);
    const html = await disclosedMarkup(await HomePage());
    expect(html).toContain('USD');
    expect(html).toContain(locale === 'en' ? 'Latest stored day: Oct 16, 2026' : 'Dernier jour enregistré : 16 oct. 2026');
    expect(html).toContain(locale === 'en' ? '2 of 28 days' : '2 jours sur 28');
    expect(html).toContain('UTC');
  });
});


it.runIf(Boolean(process.env.B7_FIXTURE_DIR))('exports the Home synthetic component fixture when requested', async () => {
  writeB7Fixture('home', renderToStaticMarkup(await HomePage()), 'home', fixtureStyles);
});
