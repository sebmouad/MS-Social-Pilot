// @vitest-environment jsdom
import { customerCopy } from '@/modules/agency/ui/copy';
import { agencyExportCatalog } from '@/modules/agency/export-copy';
import { writeB7Fixture } from './b7-visual-fixture';
import fixtureStyles from '@/modules/agency/ui/agency.module.css';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';
import type { AgencyOverview } from '@/modules/agency/agency';
const m = vi.hoisted(() => ({ overview: vi.fn(), language: 'en' }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: async (key: string) => key === 'agency.exportCopy' ? agencyExportCatalog : customerCopy }));
vi.mock('next/headers', () => ({ headers: async () => new Headers({ 'accept-language': m.language }) }));
vi.mock('@/server/context', () => ({ requireViewer: async () => ({ user: { id: 'person' } }) }));
vi.mock('@/modules/agency/server/agency', () => ({ agencySearchLimit: async () => 40, agencyOverview: m.overview }));
import AgencyScreen from '@/modules/agency/ui/AgencyScreen';
const coverage = { channels: { covered: 1, of: 1 }, publishing: { covered: 1, of: 1 }, tasks: { covered: 0, of: 1 }, team: { covered: 1, of: 1 } };
const overview: AgencyOverview = {
  ok: true, windowDays: 14, limit: 50, truncated: false, filtered: false,
  totals: { workspaces: 1, needingAttention: 1, channels: 3, disconnected: 1, scheduled: 4, failed: 2, openTasks: null, overdueTasks: null, coverage },
  workspaces: [{ id: 'studio', name: 'Studio client', role: 'owner', state: 'available', needsAttention: true, metrics: { channels: 3, disconnected: 1, scheduled: 4, failed: 2, openTasks: null, overdueTasks: null, members: 2, clients: 1 } }],
};
beforeEach(() => { vi.clearAllMocks(); m.language = 'en'; m.overview.mockResolvedValue(overview); });
it('renders shared phone-card tables, module metrics, coverage disclosures and withheld-data explanations', async () => {
  const html = renderToStaticMarkup(await AgencyScreen({ searchParams: Promise.resolve({}) }));
  expect(html).toContain('ui-page-header__titleline'); expect(html).toContain('ui-table--stack'); expect(html).toContain('Studio client');
  expect(html.match(/class="ui-metric"/g)).toHaveLength(6);
  expect(html).toContain('ui-infotip is-warning'); expect(html).toContain('Not shown for workspaces where you lack access');
  expect(html).not.toContain('Each point shows'); expect(html).toContain('Needs attention');
});
it('offers a workspace next action and icon when there are no administered workspaces', async () => {
  m.overview.mockResolvedValue({ ...overview, totals: { ...overview.totals, workspaces: 0 }, workspaces: [] });
  const html = renderToStaticMarkup(await AgencyScreen({ searchParams: Promise.resolve({}) }));
  expect(html).toContain('ui-state__icon'); expect(html).toContain('href="/settings/workspace"'); expect(html).not.toContain('class="ui-metric"');
});

it('localizes overview labels and keeps unknown metrics as unknown in French', async () => {
  m.language = 'fr';
  const html = renderToStaticMarkup(await AgencyScreen({ searchParams: Promise.resolve({}) }));
  expect(html).toContain('Tous les espaces'); expect(html).toContain('Publications planifiées');
  expect(html).toContain('Non affiché pour les espaces'); expect(html).toContain('ui-infotip is-warning');
  expect(html).not.toContain('Chaque point indique le nombre actuel');
});


it('opens the metric-specific coverage explanation without replacing withheld counts with zeros', async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container);
  try {
    const node = await AgencyScreen({ searchParams: Promise.resolve({}) });
    await act(async () => root.render(node));
    const trigger = container.querySelector<HTMLButtonElement>('button[aria-label="About Overdue tasks"]')!;
    expect(trigger.closest('.ui-infotip')?.classList.contains('is-warning')).toBe(true);
    expect(container.textContent).not.toContain('Counted in 0 of 1');
    await act(async () => trigger.click());
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain('Counted in 0 of 1 workspaces');
    expect(trigger.closest('.ui-metric')?.querySelector('.ui-metric__value')?.textContent).toContain('Not shown');
  } finally { await act(async () => root.unmount()); container.remove(); }
});


it.runIf(Boolean(process.env.B7_FIXTURE_DIR))('exports the Agency synthetic component fixture when requested', async () => {
  writeB7Fixture('agency', renderToStaticMarkup(await AgencyScreen({ searchParams: Promise.resolve({}) })), 'agency', fixtureStyles);
});
