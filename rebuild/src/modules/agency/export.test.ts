import { customerCopy } from './ui/copy';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OperationError } from '@/lib/operation-error';
const mocks = vi.hoisted(() => ({ overview: vi.fn(), viewer: vi.fn() }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: async (key: string) => key === 'agency.exportCopy' ? agencyExportCatalog : customerCopy }));
vi.mock('./server/agency', () => ({ agencyOverview: mocks.overview, listAgencyClients: vi.fn() }));
vi.mock('@/server/context', () => ({ requireViewer: mocks.viewer }));
import { exportAgencyOverview } from './server/export';
import { executeAgencyTool } from './mcp';
import { GET } from '@/app/api/agency/route';
import { agencyExportCatalog, agencyExportCopy, agencyExportLocale } from './export-copy';

const now = new Date('2026-10-20T08:00:00Z');
const actor = { userId: 'agency-owner' };
function overview() {
  return {
    ok: true, windowDays: 30, limit: 2, truncated: true, filtered: true,
    totals: { workspaces: 2, needingAttention: 1, channels: null, disconnected: null, scheduled: 0, failed: 0, waitingConversations: 3, openTasks: 0, overdueTasks: 0,
      coverage: { channels: { covered: 0, of: 1 }, publishing: { covered: 1, of: 1 }, inbox: { covered: 1, of: 1 }, tasks: { covered: 1, of: 1 }, team: { covered: 1, of: 1 } } },
    workspaces: [
      { id: 'owned', name: ' =HYPERLINK("https://example.test")\r\nStudio', role: 'owner', state: 'available', needsAttention: false,
        metrics: { channels: null, disconnected: null, scheduled: 0, failed: 0, waitingConversations: 3, openTasks: 0, overdueTasks: 0, members: 1, clients: 0 } },
      { id: 'paused', name: 'Paused', role: 'admin', state: 'suspended', metrics: null, needsAttention: true },
    ],
  };
}
beforeEach(() => {
  vi.clearAllMocks(); mocks.overview.mockResolvedValue(overview());
  mocks.viewer.mockResolvedValue({ user: { id: actor.userId }, workspaceId: 'irrelevant' });
});

describe('agency overview exports', () => {
  it('reloads the scoped service with exact filters and records bounded coverage', async () => {
    const result = await exportAgencyOverview(actor, { format: 'json', q: ' Studio ', attentionOnly: true, sort: 'failed', order: 'asc' }, now);
    expect(mocks.overview).toHaveBeenCalledWith(actor, { q: 'Studio', attentionOnly: true, sort: 'failed', order: 'asc' }, now);
    const data = JSON.parse(result.contents);
    expect(data).toMatchObject({ generatedAt: now.toISOString(), truncated: true, limit: 2, windowDays: 30, totalsIgnoreAttentionFilter: true, exportedWorkspaces: 2 });
    expect(data.totals.channels).toBeNull(); expect(data.totals.scheduled).toBe(0);
    expect(data.totals.coverage.channels).toEqual({ covered: 0, of: 1 });
    expect(data.workspaces[1].metrics).toBeNull();
    expect(result.bytes).toBe(Buffer.byteLength(result.contents));
  });
  it('quotes CSV, neutralizes formulas and preserves null versus measured zero', async () => {
    const result = await exportAgencyOverview(actor, { format: 'csv' }, now);
    expect(result.contents).toContain('"\' =HYPERLINK(""https://example.test"")\r\nStudio"');
    expect(result.contents).toContain('"Channels","Not available"');
    expect(result.contents).toContain('"Scheduled posts","0"');
    expect(result.contents).toContain('"Waiting conversations","3"');
    expect(result.contents).toContain('"Coverage","","","Inbox","1","1"');
    expect(result.contents).toContain('"Workspace","paused","Paused","Channels","Not available"');
    expect(result.contents).toContain('"Workspace scan truncated","Yes"');
    expect(result.contents).toContain('"Coverage","","","Channels","0","1"');
    expect(result.bytes).toBe(Buffer.byteLength(result.contents, 'utf8'));
  });
  it('keeps cap and filter context even with no exported rows', async () => {
    mocks.overview.mockResolvedValue({ ...overview(), workspaces: [] });
    const result = await exportAgencyOverview(actor, { format: 'csv', attentionOnly: true }, now);
    expect(result.contents).toContain('"Exported workspaces","0"');
    expect(result.contents).toContain('"Matching workspaces","2"');
    expect(result.contents).toContain('"Attention filter","Yes"');
  });
  it('provides French copy and exact UTF-8 bytes', async () => {
    const result = await exportAgencyOverview(actor, { format: 'csv', locale: 'fr' }, now);
    expect(result.contents).toContain('Non disponible'); expect(result.contents).toContain('Publications planifiées');
    expect(result.bytes).toBeGreaterThan(result.contents.length);
    expect(Object.keys(agencyExportCopy.fr).sort()).toEqual(Object.keys(agencyExportCopy.en).sort());
    expect(agencyExportLocale('fr-FR,fr;q=0.9')).toBe('fr'); expect(agencyExportLocale(null)).toBe('en');
  });
  it('rejects caller-provided rows, workspace scope and unsupported options before reading', async () => {
    for (const bad of [{ format: 'pdf' }, { format: 'csv', locale: 'de' }, { format: 'csv', workspaceId: 'foreign' }, { format: 'csv', workspaces: [] }, { format: 'csv', sort: 'token' }]) {
      await expect(exportAgencyOverview(actor, bad)).rejects.toMatchObject({ code: 'invalid_request' });
    }
    expect(mocks.overview).not.toHaveBeenCalled();
  });
  it('rechecks authority on every export and propagates revocation', async () => {
    await exportAgencyOverview(actor, { format: 'json' });
    mocks.overview.mockRejectedValueOnce(new OperationError('forbidden', 'revoked'));
    await expect(exportAgencyOverview(actor, { format: 'json' })).rejects.toMatchObject({ code: 'forbidden' });
    expect(mocks.overview).toHaveBeenCalledTimes(2);
  });
});

describe('shared HTTP/MCP export boundary', () => {
  const url = 'http://app.test/api/agency';
  it('packages through HTTP using only the person with no caching', async () => {
    const response = await GET(new Request(`${url}?format=json&locale=fr&q=Studio&attention=true`));
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
    expect(JSON.parse((await response.json()).contents).unavailableLabel).toBe('Non disponible');
    expect(mocks.overview).toHaveBeenCalledWith(actor, { q: 'Studio', sort: 'attention', order: 'desc', attentionOnly: true }, expect.any(Date));
  });
  it('rejects malformed requests and workspace credentials before data reads', async () => {
    for (const suffix of ['?format=pdf', '?format=csv&locale=xx', '?format=csv&format=json', '?format=csv&workspaceId=other', '?view=clients&format=csv', '?locale=fr']) {
      expect((await GET(new Request(url + suffix))).status).toBe(400);
    }
    for (const headers of [new Headers({ authorization: 'Bearer key' }), new Headers({ 'x-api-key': 'key' })]) {
      expect((await GET(new Request(`${url}?format=json`, { headers }))).status).toBe(403);
    }
    expect(mocks.overview).not.toHaveBeenCalled();
  });
  it('maps anonymous and revoked session access to failures', async () => {
    mocks.viewer.mockRejectedValueOnce({ digest: 'NEXT_REDIRECT;replace;/sign-in;307;' });
    expect((await GET(new Request(`${url}?format=csv`))).status).toBe(401);
    mocks.overview.mockRejectedValueOnce(new OperationError('forbidden', 'revoked'));
    expect((await GET(new Request(`${url}?format=csv`))).status).toBe(403);
  });
  it('uses the same export for the person tool and refuses workspace/installation principals', async () => {
    expect(await executeAgencyTool({ scope: 'person', ...actor }, 'get_agency_overview', { format: 'json' })).toMatchObject({ version: 1, filename: 'agency-overview.json' });
    mocks.overview.mockClear();
    for (const identity of [{ scope: 'workspace', ...actor, workspaceId: 'owned' }, { scope: 'person', ...actor, apiKeyId: 'key' }, { scope: 'installation', ...actor, isInstanceOwner: true }]) {
      await expect(executeAgencyTool(identity, 'get_agency_overview', { format: 'csv' })).rejects.toMatchObject({ code: 'forbidden' });
    }
    expect(mocks.overview).not.toHaveBeenCalled();
  });
});
