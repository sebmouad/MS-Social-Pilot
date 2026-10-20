import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  actor: vi.fn(),
  plans: { listRootPlans: vi.fn(), listRootPlanHistory: vi.fn(), listRootSubscribers: vi.fn(), updateRootPlan: vi.fn(), assignRootPlan: vi.fn() },
  priv: { listRootPrivileges: vi.fn(), exportRootPrivileges: vi.fn(), changeRootMemberRole: vi.fn() },
  life: { loadRootLifecycle: vi.fn(), transferWorkspaceOwnership: vi.fn(), setLifecycleUserAccess: vi.fn(), setLifecycleWorkspaceAccess: vi.fn() },
  errs: { listRootErrors: vi.fn(), getRootError: vi.fn(), setRootErrorResolved: vi.fn() },
  back: { readRootBackupStatus: vi.fn(), readRootDiagnosticsSummary: vi.fn() },
}));
vi.mock('../src/server/config/access', () => ({ currentRootActor: h.actor }));
vi.mock('../src/server/root/legacy/plans', () => h.plans);
vi.mock('../src/server/root/legacy/privileges', () => h.priv);
vi.mock('../src/server/root/legacy/lifecycle', () => h.life);
vi.mock('../src/server/root/legacy/errors', () => h.errs);
vi.mock('../src/server/root/legacy/backups', () => h.back);

import { GET as plansGet } from '../src/app/api/root/plans/route';
import { PATCH as planPatch } from '../src/app/api/root/plans/[id]/route';
import { POST as assign } from '../src/app/api/root/plans/assign/route';
import { GET as privGet, POST as privPost } from '../src/app/api/root/privileges/route';
import { GET as privExport } from '../src/app/api/root/privileges/export/route';
import { PATCH as userAccess } from '../src/app/api/root/lifecycle/users/[id]/route';
import { POST as transfer } from '../src/app/api/root/lifecycle/ownership/route';
import { POST as resolveError } from '../src/app/api/root/errors/[id]/route';
import { GET as backupsGet } from '../src/app/api/root/backups/route';
import * as backupsModule from '../src/app/api/root/backups/route';
import { rootLegacyToolDefinitions, rootLegacyResources, callRootLegacyTool, canUseRootLegacyTool } from '../src/server/root/legacy/mcp';
import { rootToolDefinitions } from '../src/server/mcp/root-tools';

const url = 'https://app.example.test/api/root/x';
const get = (path = url) => new Request(path);
const post = (body: unknown, origin: string | null = 'https://app.example.test') => new Request(url, { method: 'POST', headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) }, body: JSON.stringify(body) });
const ctx = (id = 'p1') => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  h.actor.mockResolvedValue({ id: 'root', isInstanceOwner: true });
});

describe('private Root HTTP boundary', () => {
  it('returns 401 for anonymous and 404 for signed-in non-Root callers, for reads and writes, without calling services', async () => {
    h.actor.mockResolvedValue(null);
    expect((await plansGet(get(), undefined)).status).toBe(401);
    expect((await backupsGet(get(), undefined)).status).toBe(401);
    h.actor.mockResolvedValue({ id: 'member', isInstanceOwner: false });
    expect((await plansGet(get(), undefined)).status).toBe(404);
    expect((await privExport(get(), undefined)).status).toBe(404);
    expect((await assign(post({ userId: 'u', planKey: null, confirmation: 'x' }), undefined)).status).toBe(404);
    expect((await planPatch(post({}), ctx())).status).toBe(404);
    for (const group of [h.plans, h.priv, h.life, h.errs, h.back]) for (const fn of Object.values(group)) expect(fn).not.toHaveBeenCalled();
  });

  it('rejects cross-origin and origin-less writes before authenticating', async () => {
    expect((await assign(post({}, 'https://evil.example.test'), undefined)).status).toBe(403);
    expect((await privPost(post({}, null), undefined)).status).toBe(403);
    expect(h.actor).not.toHaveBeenCalled();
  });

  it('passes the authenticated actor and query/body through and returns an explicit ok receipt', async () => {
    h.priv.listRootPrivileges.mockResolvedValue({ items: [], total: 0 });
    const res = await privGet(get('https://app.example.test/api/root/privileges?role=admin&page=2'), undefined);
    expect(await res.json()).toMatchObject({ ok: true, total: 0 });
    expect(res.headers.get('cache-control')).toContain('no-store');
    expect(h.priv.listRootPrivileges).toHaveBeenCalledWith('root', { role: 'admin', page: '2' });
    h.plans.updateRootPlan.mockResolvedValue({ changed: true });
    await planPatch(new Request(url, { method: 'PATCH', headers: { origin: 'https://app.example.test' }, body: JSON.stringify({ patch: { name: 'X' }, confirmation: 'c' }) }), ctx('plan-9'));
    expect(h.plans.updateRootPlan).toHaveBeenCalledWith('root', 'plan-9', { patch: { name: 'X' }, confirmation: 'c' });
  });

  it('maps safe operation errors, hides unexpected failures and rejects malformed bodies', async () => {
    const { OperationError } = await import('../src/lib/operation-error');
    h.life.transferWorkspaceOwnership.mockRejectedValueOnce(new OperationError('conflict', 'That account already owns this workspace.'));
    const conflict = await transfer(post({}), undefined);
    expect(conflict.status).toBe(409);
    h.life.transferWorkspaceOwnership.mockRejectedValueOnce(new Error('connect ECONNREFUSED 10.0.0.5 password=hunter2'));
    const failed = await transfer(post({}), undefined);
    expect(JSON.stringify(await failed.json())).not.toMatch(/ECONNREFUSED|hunter2/);
    const bad = await userAccess(post({ disabled: 'yes', confirmation: 'x' }), ctx('u1'));
    expect(bad.status).toBe(400);
    expect(h.life.setLifecycleUserAccess).not.toHaveBeenCalled();
    const malformed = await resolveError(new Request(url, { method: 'POST', headers: { origin: 'https://app.example.test' }, body: '{nope' }), ctx('e1'));
    expect(malformed.status).toBe(400);
  });

  it('refuses partial CSV, confirms complete downloads, and exposes no backup write method', async () => {
    h.priv.exportRootPrivileges.mockResolvedValue({ csv: 'a,b\r\n', rows: 1, total: 5, truncated: true });
    expect((await privExport(get(), undefined)).status).toBe(400);
    h.priv.exportRootPrivileges.mockResolvedValue({ csv: 'a,b\r\n', bytes: 5, rows: 1, total: 1, truncated: false });
    const res = await privExport(get(), undefined);
    expect(res.headers.get('x-export-truncated')).toBe('false');
    expect(res.headers.get('x-msp-export-format')).toBe('root-privileges-v1');
    expect(res.headers.get('content-type')).toContain('text/csv');
    expect(Object.keys(backupsModule).filter(key => ['POST', 'PUT', 'PATCH', 'DELETE'].includes(key))).toEqual([]);
  });
});

describe('Root MCP definitions', () => {
  it('uses unique names that do not collide with existing Root tools, and every resource targets a defined tool', () => {
    const names = rootLegacyToolDefinitions.map(tool => tool.name);
    expect(new Set(names).size).toBe(names.length);
    const merged = rootToolDefinitions.map(tool => tool.name);
    expect(new Set(merged).size).toBe(merged.length);
    expect(names.every(name => merged.includes(name))).toBe(true);
    expect(rootLegacyResources.every(resource => names.includes(resource.tool))).toBe(true);
    expect(rootLegacyToolDefinitions.every(tool => tool.description.includes('API keys cannot use'))).toBe(true);
  });

  it('denies workspace API keys and non-owners before any service call', async () => {
    expect(canUseRootLegacyTool({ userId: 'u', isInstanceOwner: true, apiKeyId: 'k' } as never)).toBe(false);
    await expect(callRootLegacyTool({ userId: 'u', isInstanceOwner: true, apiKeyId: 'k' } as never, 'list_root_plans', {})).rejects.toMatchObject({ code: 'forbidden' });
    await expect(callRootLegacyTool({ userId: 'u', isInstanceOwner: false } as never, 'get_root_backup_status', {})).rejects.toMatchObject({ code: 'forbidden' });
    expect(h.plans.listRootPlans).not.toHaveBeenCalled();
    expect(h.back.readRootBackupStatus).not.toHaveBeenCalled();
  });

  it('dispatches for the installation owner, rejects stray arguments and unknown tools', async () => {
    const viewer = { userId: 'root', isInstanceOwner: true } as never;
    h.plans.updateRootPlan.mockResolvedValue({ changed: true });
    await callRootLegacyTool(viewer, 'update_root_plan', { planId: 'p1', patch: { name: 'X' }, confirmation: 'c' });
    expect(h.plans.updateRootPlan).toHaveBeenCalledWith('root', 'p1', { patch: { name: 'X' }, confirmation: 'c' });
    await callRootLegacyTool(viewer, 'transfer_root_workspace_ownership', { workspaceId: 'w' });
    expect(h.life.transferWorkspaceOwnership).toHaveBeenCalledWith('root', { workspaceId: 'w' });
    await expect(callRootLegacyTool(viewer, 'get_root_backup_status', { force: true })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(callRootLegacyTool(viewer, 'run_backup', {})).rejects.toMatchObject({ code: 'not_found' });
    await expect(callRootLegacyTool(viewer, 'list_root_plans', [] as never)).rejects.toMatchObject({ code: 'invalid_request' });
  });

  it('offers no tool that starts, restores or deletes backups, accounts or workspaces', () => {
    expect(rootLegacyToolDefinitions.map(tool => tool.name).filter(name => /backup|restore|delete|purge/.test(name) && !name.startsWith('get_'))).toEqual(['delete_root_user', 'delete_root_workspace']); // deliberate, confirmed deletions of disabled accounts and suspended workspaces
  });
});

describe('strict query parsing', () => {
  it('rejects repeated and unknown query parameters before calling services', async () => {
    expect((await privGet(get(`${url}?role=admin&role=owner`), undefined)).status).toBe(400);
    expect((await privGet(get(`${url}?bogus=1`), undefined)).status).toBe(400);
    expect((await backupsGet(get(`${url}?x=1`), undefined)).status).toBe(400);
    expect(h.priv.listRootPrivileges).not.toHaveBeenCalled();
    expect(h.back.readRootBackupStatus).not.toHaveBeenCalled();
    h.priv.listRootPrivileges.mockResolvedValue({ items: [] });
    expect((await privGet(get(`${url}?role=admin&page=2`), undefined)).status).toBe(200);
  });
});


describe('MCP error action confirmation', () => {
  it('requires the exact explicit confirmation and rejects stray read arguments', async () => {
    const viewer = { userId: 'root', isInstanceOwner: true } as never;
    await expect(callRootLegacyTool(viewer, 'set_root_error_resolved', { id: 'e1', resolved: true })).rejects.toMatchObject({ code: 'invalid_request' });
    expect(h.errs.setRootErrorResolved).not.toHaveBeenCalled();
    await callRootLegacyTool(viewer, 'set_root_error_resolved', { id: 'e1', resolved: true, confirmation: 'RESOLVE ROOT ERROR e1' });
    expect(h.errs.setRootErrorResolved).toHaveBeenCalledWith('root', 'e1', true);
    await expect(callRootLegacyTool(viewer, 'get_root_error', { id: 'e1', extra: true })).rejects.toMatchObject({ code: 'invalid_request' });
  });
});
