import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { THEMES } from '../src/lib/themes';
import { contrastRatio, discoverRootRoutes, EXTENDED_MODES, finishExtended, PUBLIC_ROUTES, VIEWPORTS, type ExtendedCell, type RouteGroup } from '../scripts/verify-browser-matrix';

const groups: Record<RouteGroup, string[]> = { customer: ['/home'], root: ['/root'], public: [PUBLIC_ROUTES[0]] };
function complete(): ExtendedCell[] {
  return (Object.keys(groups) as RouteGroup[]).flatMap(group => groups[group].flatMap(route => THEMES.flatMap(theme => EXTENDED_MODES.flatMap(mode => VIEWPORTS.map(viewport => (
    { group, route, theme: theme.id, mode, viewport, findings: [], details: [], blockedExternal: 0, contrastSampled: 10 }))))));
}
const input = (cells: ExtendedCell[]) => ({ startedAt: '2026-10-21T00:00:00.000Z', groups, excludedDynamicRoutes: [], cells, fatal: [] });

describe('extended appearance matrix', () => {
  it('requires every theme x mode x viewport cell in each route group', () => {
    const report = finishExtended(input(complete()));
    expect(report.expectedCells).toBe(3 * THEMES.length * EXTENDED_MODES.length * VIEWPORTS.length);
    expect(report.passed).toBe(true);
    const missing = complete(); missing.pop();
    expect(finishExtended(input(missing))).toMatchObject({ passed: false, fatal: [{ code: 'INCOMPLETE_MATRIX' }] });
  });
  it('fails on any cell finding and on duplicate cells', () => {
    const cells = complete(); cells[0].findings.push({ code: 'CONTRAST_LOW', count: 2 });
    expect(finishExtended(input(cells))).toMatchObject({ passed: false, failures: 1 });
    expect(finishExtended(input([...complete(), complete()[0]])).fatal).toContainEqual({ code: 'UNEXPECTED_OR_DUPLICATE_CELL' });
  });
  it('computes WCAG contrast ratios', () => {
    expect(contrastRatio([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 5);
    expect(contrastRatio([255, 255, 255], [255, 255, 255])).toBeCloseTo(1, 5);
    expect(contrastRatio([119, 119, 119], [255, 255, 255])).toBeGreaterThan(4.4);
    expect(contrastRatio([29, 158, 117], [246, 245, 253])).toBeLessThan(4.5);
  });
  it('discovers Root pages and excludes dynamic ones', () => {
    const root = discoverRootRoutes(fileURLToPath(new URL('../src/app', import.meta.url)));
    expect(root.routes).toEqual(expect.arrayContaining(['/root', '/root/config', '/root/modules']));
    expect(root.routes.some(route => route.includes('['))).toBe(false);
    expect(root.excludedDynamicRoutes).toContain('/root/modules/[id]');
  });
});
