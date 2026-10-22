import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ actor: vi.fn(), read: vi.fn(), run: vi.fn(), test: vi.fn() }));
vi.mock('../src/server/config/access', () => ({ currentRootActor: mocks.actor }));
vi.mock('../src/modules/root/server/operator-monitoring', () => ({ readRootOperatorMonitoring: mocks.read, runRootOperatorMonitoring: mocks.run, testRootOperatorMonitoring: mocks.test }));
import { POST as TEST } from '../src/app/api/root/monitoring/test/route';
import { GET, POST } from '../src/app/api/root/monitoring/route';
import { executeRootMonitoringTool, rootMonitoringResources, rootMonitoringToolDefinitions } from '../src/modules/root/mcp';
import { ROOT_MONITORING_COPY, rootMonitoringCopySchema } from '../src/modules/root/monitoring-config';
beforeEach(() => { vi.resetAllMocks(); mocks.actor.mockResolvedValue({ id: 'root', isInstanceOwner: true }); mocks.read.mockResolvedValue({ alerts: [], uptime: [] }); mocks.test.mockResolvedValue({ id: 'test', queued: true }); mocks.run.mockResolvedValue({ opened: [], resolved: [], checks: [], uptime: { app: true, worker: true } }); });
describe('Root monitoring thin surfaces', () => {
  it('REST and MCP use the same readers and evaluation service', async () => {
    expect((await GET(new Request('http://local/api/root/monitoring'))).status).toBe(200);
    await executeRootMonitoringTool('root', 'get_root_monitoring', {}, 7);
    expect(mocks.read.mock.calls).toEqual([['root'], ['root', 7]]);
    const confirmation = 'EVALUATE ROOT MONITORING';
    expect((await POST(new Request('http://local/api/root/monitoring', { method: 'POST', body: JSON.stringify({ confirmation }) }))).status).toBe(200);
    await executeRootMonitoringTool('root', 'evaluate_root_monitoring', { confirmation });
    expect(mocks.run.mock.calls).toEqual([['root', confirmation], ['root', confirmation]]);
  });
  it('rejects anonymous callers and extra fields before executing', async () => {
    mocks.actor.mockResolvedValue(null);
    expect((await GET(new Request('http://local/api/root/monitoring'))).status).toBe(401);
    expect(mocks.read).not.toHaveBeenCalled();
    mocks.actor.mockResolvedValue({ id: 'root' });
    expect((await POST(new Request('http://local/api/root/monitoring', { method: 'POST', body: JSON.stringify({ confirmation: 'x', unsafe: true }) }))).status).toBe(400);
    await expect(executeRootMonitoringTool('root', 'evaluate_root_monitoring', { confirmation: 'x', unsafe: true })).rejects.toMatchObject({ code: 'invalid_request' });
    expect(mocks.run).not.toHaveBeenCalled();
  });
  it('declares resource and strict bilingual Root catalog', () => {
    expect(rootMonitoringResources[0].tool).toBe('get_root_monitoring');
    expect(rootMonitoringToolDefinitions).toHaveLength(3);
    expect(rootMonitoringCopySchema.parse(ROOT_MONITORING_COPY)).toEqual(ROOT_MONITORING_COPY);
  });
});


it('REST and MCP queue the same confirmed test and reject cross-origin test requests', async () => {
  const confirmation = 'TEST ROOT MONITORING';
  const request = (origin: string) => new Request('http://local/api/root/monitoring/test', { method: 'POST', headers: { origin }, body: JSON.stringify({ confirmation }) });
  expect((await TEST(request('http://other'))).status).toBe(403);
  expect(mocks.test).not.toHaveBeenCalled();
  expect((await TEST(request('http://local'))).status).toBe(200);
  await executeRootMonitoringTool('root', 'test_root_monitoring', { confirmation });
  expect(mocks.test.mock.calls).toEqual([['root', confirmation], ['root', confirmation]]);
});
