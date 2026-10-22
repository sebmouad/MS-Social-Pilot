import { describe, expect, it } from 'vitest';
import { MODULES, PAGES } from '@/lib/product';
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
    expect(PAGES).toEqual(moduleManifests.flatMap((manifest) => manifest.pages.map((page) => ({ ...page, module: manifest.id, area: (manifest as { area?: string }).area }))));
    // Every module places its pages in a sidebar area (design v2).
    expect(PAGES.every(({ area }) => ['home', 'content', 'inbox', 'insights', 'tasks', 'agency', 'settings'].includes(area))).toBe(true);
  });

  it('does not expose internal Root routes as customer features', () => {
    expect(MODULES.map(({ id }) => String(id))).not.toContain('root');
    expect(PAGES.some(({ href }) => href === '/root' || href.startsWith('/root/'))).toBe(false);
  });

  it('shows the Analytics overview, audience, comparison, goals and pins pages while retaining scoped CSV export as a capability', () => {
    expect(PAGES.filter(({ module, navigation }) => module === 'analytics' && navigation !== false).map(({ href }) => href)).toEqual([
      '/analytics', '/analytics/demographics', '/analytics/compare', '/analytics/ads', '/analytics/posts', '/analytics/goals', '/analytics/pins', '/analytics/reports',
    ]);
    expect(PAGES.find(({ id }) => id === 'analytics/reports')?.href).toBe('/analytics/reports');
    expect(moduleManifests.find(({id})=>id==='analytics')?.jobs).toEqual(expect.arrayContaining([expect.objectContaining({name:'analyticsReports',configKey:'analytics.reports.schedule'})]));
    expect(PAGES.find(({ id }) => id === 'analytics/explorer')?.navigation).toBe(false);
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
    expect(PAGES.find(page => page.id === 'settings/notifications')).toMatchObject({ href: '/settings/notifications', title: 'Notifications', module: 'settings' });
    expect(PAGES.filter(page => page.id === 'settings/account')).toHaveLength(1);
    expect(CONFIG_BY_KEY.get('notifications.deliverySchedule')?.schema.safeParse('*/2 * * * *').success).toBe(true);
    expect(CONFIG_BY_KEY.get('jobs.order')?.defaultValue).toContain('notifications');
  });
});
