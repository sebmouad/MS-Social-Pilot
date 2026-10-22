import { describe, expect, it } from 'vitest';
import { PAGES } from '../src/lib/product';
import { ROUTE_REDIRECTS, resolveRedirect } from '../src/lib/route-redirects';

describe('route redirects', () => {
  const table = [
    { from: '/publishing/compose', to: '/create' },
    { from: '/analytics/*', to: '/insights/*', params: { range: 'period' } },
  ] as const;

  it('maps an exact route, keeps unknown parameters and moves old channel names to channel', () => {
    expect(resolveRedirect('/publishing/compose', '?date=2026-10-30&channelId=a&keep=1', table)).toBe('/create?date=2026-10-30&channel=a&keep=1');
  });
  it('moves a whole prefix with its tail and renames the declared parameters', () => {
    expect(resolveRedirect('/analytics/posts', '?range=28', table)).toBe('/insights/posts?period=28');
    expect(resolveRedirect('/analytics', '', table)).toBe('/insights');
    expect(resolveRedirect('/analyticsx', '', table)).toBeNull();
  });
  it('leaves other routes alone', () => {
    expect(resolveRedirect('/inbox', '?channel=a', table)).toBeNull();
  });
  it('lands every declared redirect on an existing page or area root', () => {
    const known = new Set(PAGES.map(page => page.href));
    for (const entry of ROUTE_REDIRECTS) {
      const target = entry.to.endsWith('/*') ? entry.to.slice(0, -2) : entry.to;
      expect(known.has(target) || [...known].some(href => href.startsWith(`${target}/`)) || target === '/create', entry.to).toBe(true);
    }
  });
});
