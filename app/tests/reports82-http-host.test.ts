import { beforeEach, describe, expect, it, vi } from 'vitest';
const stubs = vi.hoisted(() => ({ ensure: vi.fn(), actor: vi.fn(), run: vi.fn(), schedules: vi.fn(), templates: vi.fn(), history: vi.fn(), limit: 256 }));
vi.mock('@/modules/analytics/server/report-workflows', () => ({ ensureReportWorkflows: stubs.ensure }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: async (key: string) => { if (key !== 'analytics.reports.requestMaxBytes') throw Error('Unexpected policy'); return stubs.limit; } }));
vi.mock('@/modules/analytics/http', async original => ({ ...await original<typeof import('../src/modules/analytics/http')>(), viewerActor: stubs.actor }));
vi.mock('@/modules/analytics/reports/generation/runs', () => ({ runReportNow: stubs.run, listReportRuns: stubs.history }));
vi.mock('@/modules/analytics/reports/server/schedules', () => ({ listReportSchedules: stubs.schedules, manageReportSchedule: stubs.schedules }));
vi.mock('@/modules/analytics/reports/server/templates', () => ({ listReportTemplates: stubs.templates, manageReportTemplate: stubs.templates }));
import { POST as prepare } from '../src/app/api/analytics/report-workflows/run/route';
import { POST as schedule } from '../src/app/api/analytics/report-workflows/schedules/route';
import { POST as template } from '../src/app/api/analytics/report-workflows/templates/route';
import { GET as history } from '../src/app/api/analytics/report-workflows/runs/route';
const request = (body: string, origin = 'http://localhost:3200') => new Request('http://localhost:3200/api/analytics/report-workflows/run', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body });
beforeEach(() => { vi.clearAllMocks(); stubs.limit = 256; stubs.actor.mockResolvedValue({ userId: 'user', workspaceId: 'workspace' }); stubs.run.mockResolvedValue({ ok: true }); stubs.schedules.mockResolvedValue({ ok: true, action: 'create' }); stubs.templates.mockResolvedValue({ ok: true, action: 'create' }); stubs.history.mockResolvedValue({ ok: true, runs: [] }); });
describe('Reports HTTP host assembly and request bounds', () => {
  it('assembles generation on direct cold preparation, schedule creation and history requests', async () => {
    expect((await prepare(request('{}'))).status).toBe(201);
    expect((await schedule(request('{}'))).status).toBe(201);
    expect((await history(new Request('http://localhost:3200/api/analytics/report-workflows/runs'))).status).toBe(200);
    expect(stubs.ensure).toHaveBeenCalledTimes(3);
  });
  it('denies cross-origin and unauthenticated writes before dispatch or assembly', async () => {
    expect((await prepare(request('{}', 'https://foreign.example'))).status).toBe(403);
    stubs.actor.mockResolvedValue(null);
    expect((await schedule(request('{}'))).status).toBe(401);
    expect(stubs.ensure).not.toHaveBeenCalled(); expect(stubs.run).not.toHaveBeenCalled(); expect(stubs.schedules).not.toHaveBeenCalled();
  });
  it('bounds streamed bytes without trusting Content-Length on every write route', async () => {
    for (const route of [prepare, schedule, template]) {
      const input = request(JSON.stringify({ text: 'é'.repeat(150) })); input.headers.set('content-length', '2');
      expect((await route(input)).status).toBe(400);
    }
    expect(stubs.run).not.toHaveBeenCalled(); expect(stubs.schedules).not.toHaveBeenCalled(); expect(stubs.templates).not.toHaveBeenCalled();
  });
  it('reports safe assembly failure instead of pretending authentication failed', async () => {
    stubs.ensure.mockRejectedValueOnce(Error('private host failure'));
    const response = await prepare(request('{}'));
    expect(response.status).toBe(502); expect(JSON.stringify(await response.json())).not.toContain('private host failure');
  });
});
