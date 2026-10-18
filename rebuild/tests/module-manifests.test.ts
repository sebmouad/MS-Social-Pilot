import { describe, expect, it } from 'vitest';
import { MODULES, PAGES } from '@/lib/product';
import { moduleManifests } from '@/modules';

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
    expect(PAGES).toEqual(moduleManifests.flatMap(({ id: module, pages }) => pages.map((page) => ({ ...page, module }))));
  });

  it('does not expose internal Root routes as customer features', () => {
    expect(MODULES.map(({ id }) => String(id))).not.toContain('root');
    expect(PAGES.some(({ href }) => href === '/root' || href.startsWith('/root/'))).toBe(false);
  });

  it('shows the Analytics overview, audience, comparison and pins pages while retaining scoped CSV export as a capability', () => {
    expect(PAGES.filter(({ module, navigation }) => module === 'analytics' && navigation !== false).map(({ href }) => href)).toEqual([
      '/analytics', '/analytics/demographics', '/analytics/compare', '/analytics/pins',
    ]);
    expect(PAGES.find(({ id }) => id === 'analytics/reports')?.navigation).toBe(false);
    expect(PAGES.find(({ id }) => id === 'analytics/explorer')?.navigation).toBe(false);
  });

  it('uses a compact mobile title for Publishing', () => {
    expect(MODULES.find(({ id }) => id === 'publishing')?.mobileTitle).toBe('Publish');
  });
});
