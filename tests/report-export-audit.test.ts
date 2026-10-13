import { beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ auth: vi.fn(), build: vi.fn(async (options: unknown) => options), selection: vi.fn(async () => ({ ids: ['stale-page'] })) }));
vi.mock('../src/lib/auth', () => ({ requireAuth: m.auth }));
vi.mock('../src/lib/page-filter', () => ({ loadSelection: m.selection }));
vi.mock('../src/lib/api', () => ({ route: (fn: unknown) => fn, ok: (body: unknown) => Response.json(body) }));
vi.mock('../src/lib/reports', () => ({ buildReport: m.build, parseReportRange: () => ({ ok: true, from: new Date('2026-10-01'), to: new Date('2026-10-12') }), reportToCsv: (report: { targetIds: string[] }) => report.targetIds.join('\n'), csvFilename: () => 'report.csv' }));
import { GET } from '../src/app/api/reports/route';
beforeEach(() => { vi.clearAllMocks(); m.auth.mockResolvedValue({ workspace: { id: 'workspace-a', slug: 'a', timezone: 'UTC' }, pageScope: { all: true, ids: [] } }); });
it('exports exactly the explicit applied scope, ignoring stale remembered selection', async () => {
  const response = await GET(new Request('https://example.test/api/reports?pages=page-a&format=csv'));
  expect(await response.text()).toBe('page-a');
  expect(m.selection).not.toHaveBeenCalled();
  expect(m.build).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 'workspace-a', targetIds: ['page-a'] }));
});
it('intersects forged requested channels with member authorization', async () => {
  m.auth.mockResolvedValue({ workspace: { id: 'workspace-a', slug: 'a', timezone: 'UTC' }, pageScope: { all: false, ids: ['page-a'] } });
  await GET(new Request('https://example.test/api/reports?pages=page-a,page-b,other-workspace'));
  expect(m.build).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 'workspace-a', targetIds: ['page-a'] }));
});
it('keeps an explicit empty scope empty rather than reading a saved selection', async () => {
  await GET(new Request('https://example.test/api/reports?pages='));
  expect(m.build).toHaveBeenCalledWith(expect.objectContaining({ targetIds: [] }));
  expect(m.selection).not.toHaveBeenCalled();
});
