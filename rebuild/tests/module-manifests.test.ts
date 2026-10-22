import { describe, expect, it } from 'vitest';
import { MODULES, PAGES, areaPages } from '@/lib/product';
import { moduleManifests } from '@/modules';
import { CONFIG_BY_KEY } from '@/lib/config/registry';
import { configurationOwner } from '@/lib/config/ownership';

describe('customer module manifests', () => {
  it('keeps module and feature ids and routes unique', () => {
    expect(new Set(MODULES.map(({ id }) => id)).size).toBe(MODULES.length);
    expect(new Set(PAGES.map(({ id }) => id)).size).toBe(PAGES.length);
    expect(new Set(PAGES.map(({ href }) => href)).size).toBe(PAGES.length);
  });

  it('groups every feature under its owning module and uses a child route as module entry', () => {
    for (const module of MODULES) {
      const pages = PAGES.filter((page) => page.module === module.id);
      expect(pages.length, `${module.id} should declare at least one feature`).toBeGreaterThan(0);
      expect(pages.some(({ href }) => href === module.href), `${module.id} entry route should be one of its features`).toBe(true);
    }

    expect(PAGES.every(({ id, module }) => id.startsWith(`${module}/`))).toBe(true);
  });

  it('generates the shared catalog from the independent module manifests', () => {
    expect(MODULES.map(({ id }) => id)).toEqual(moduleManifests.map(({ id }) => id));
    expect(PAGES).toEqual(moduleManifests.flatMap((manifest) => manifest.pages.map((page) => ({ ...page, module: manifest.id, area: (page as { area?: string }).area ?? (manifest as { area?: string }).area }))));
    // Every module places its pages in a sidebar area (design v2).
    expect(PAGES.every(({ area }) => ['home', 'content', 'inbox', 'insights', 'ads', 'tasks', 'agency', 'settings'].includes(area))).toBe(true);
  });

  it('does not expose internal Root routes as customer features', () => {
    expect(MODULES.map(({ id }) => String(id))).not.toContain('root');
    expect(PAGES.some(({ href }) => href === '/root' || href.startsWith('/root/'))).toBe(false);
  });

  it('shows the Insights tabs in order (Overview, Explore, Audience, Posts, Compare, Reports) and keeps goals and pins as sub-pages', () => {
    expect(areaPages('insights', PAGES.map(({ id }) => id)).map(({ href }) => href)).toEqual([
      '/insights', '/insights/explore', '/insights/audience', '/insights/posts', '/insights/compare', '/insights/reports',
    ]);
    for (const id of ['analytics/goals', 'analytics/pins']) expect(PAGES.find(page => page.id === id)?.navigation, id).toBe(false);
    expect(PAGES.find(({ id }) => id === 'analytics/reports')?.href).toBe('/insights/reports');
    expect(moduleManifests.find(({id})=>id==='analytics')?.jobs).toEqual(expect.arrayContaining([expect.objectContaining({name:'analyticsReports',configKey:'analytics.reports.schedule'})]));
    expect(PAGES.find(({ id }) => id === 'analytics/explorer')?.href).toBe('/insights/explore');
  });

  it('shows the Ads area tabs in order (Accounts, Campaigns, Manage, Analysis, Compare), with Analysis owned by Analytics', () => {
    expect(areaPages('ads', PAGES.map(({ id }) => id)).map(({ href }) => href)).toEqual([
      '/ads', '/ads/campaigns', '/ads/manage', '/ads/analysis', '/ads/compare',
    ]);
    expect(PAGES.find(({ id }) => id === 'analytics/ads')).toMatchObject({ module: 'analytics', area: 'ads', href: '/ads/analysis' });
    expect(PAGES.find(({ id }) => id === 'ads/overview')).toMatchObject({ module: 'ads', area: 'ads', href: '/ads' });
  });

  it('uses a compact mobile title for Publishing', () => {
    expect(MODULES.find(({ id }) => id === 'publishing')?.mobileTitle).toBe('Publish');
  });

  it('declares Publishing automation jobs with module-owned validated Root schedules', () => {
    const publishing = moduleManifests.find(module => module.id === 'publishing')!;
    expect(publishing.jobs.filter(job => job.name.startsWith('publishing'))).toEqual([
      { name: 'publishingRecycle', label: 'Post recycling', configKey: 'publishing.automation.recycleSchedule' },
      { name: 'publishingMix', label: 'Content mix scheduling', configKey: 'publishing.automation.mixSchedule' },
    ]);
    for (const job of publishing.jobs.filter(job => job.name.startsWith('publishing'))) {
      expect(publishing.rootSettingKeys).toContain(job.configKey);
      expect(CONFIG_BY_KEY.get(job.configKey)?.schema.safeParse('15 * * * *').success).toBe(true);
    }
    expect(CONFIG_BY_KEY.get('jobs.order')?.schema.safeParse(CONFIG_BY_KEY.get('jobs.order')?.defaultValue).success).toBe(true);
    expect(CONFIG_BY_KEY.get('jobs.order')?.defaultValue).toEqual(expect.arrayContaining(['publishingRecycle', 'publishingMix']));
  });

  it('registers notification delivery under Settings with Root-owned scheduling controls', () => {
    const settings = moduleManifests.find(module => module.id === 'settings')!;
    expect(settings.jobs).toContainEqual({ name: 'notifications', label: 'Notification delivery', configKey: 'notifications.deliverySchedule' });
    expect(settings.rootSettingsPrefixes).toContain('notifications.');
    expect(configurationOwner('notifications.deliverySchedule')).toEqual({ kind: 'product', id: 'settings' });
    expect(PAGES.find(page => page.id === 'settings/notifications')).toMatchObject({ href: '/settings/account/notifications', title: 'Notifications', module: 'settings' });
    expect(PAGES.filter(page => page.id === 'settings/account')).toHaveLength(1);
    expect(CONFIG_BY_KEY.get('notifications.deliverySchedule')?.schema.safeParse('*/2 * * * *').success).toBe(true);
    expect(CONFIG_BY_KEY.get('jobs.order')?.defaultValue).toContain('notifications');
  });
});
