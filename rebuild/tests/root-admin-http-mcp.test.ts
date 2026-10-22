import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../src/server/root/registration-admin', async importOriginal => ({
  ...await importOriginal<typeof import('../src/server/root/registration-admin')>(),
  ...h.registration,
}));

const h = vi.hoisted(() => ({
  actor: vi.fn(), refreshConnection: vi.fn(),
  registration: { listRootRegistration: vi.fn(), revokeRootRegistrationInvitation: vi.fn(), controlRootRegistrationAccount: vi.fn() },
  plans: { listRootPlans: vi.fn(), listRootPlanHistory: vi.fn(), listRootSubscribers: vi.fn(), updateRootPlan: vi.fn(), assignRootPlan: vi.fn() },
  priv: { listRootPrivileges: vi.fn(), exportRootPrivileges: vi.fn(), changeRootMemberRole: vi.fn() },
  life: { loadRootLifecycle: vi.fn(), transferWorkspaceOwnership: vi.fn(), setLifecycleUserAccess: vi.fn(), setLifecycleWorkspaceAccess: vi.fn() },
  errs: { listRootErrors: vi.fn(), getRootError: vi.fn(), setRootErrorResolved: vi.fn() },
  back: { readRootBackupStatus: vi.fn(), readRootDiagnosticsSummary: vi.fn() },
}));
vi.mock('../src/modules/root/server/admin/connection-refresh', () => ({ refreshRootConnection: h.refreshConnection }));
vi.mock('../src/server/config/access', () => ({ currentRootActor: h.actor }));
vi.mock('../src/modules/root/server/admin/plans', () => h.plans);
vi.mock('../src/modules/root/server/admin/privileges', () => h.priv);
vi.mock('../src/modules/root/server/admin/lifecycle', () => h.life);
vi.mock('../src/modules/root/server/admin/errors', () => h.errs);
vi.mock('../src/modules/root/server/admin/backups', () => h.back);

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
import { rootAdminToolDefinitions, rootAdminResources, callRootAdminTool, canUseRootAdminTool } from '../src/modules/root/server/admin/mcp';
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
    const names = rootAdminToolDefinitions.map(tool => tool.name);
    expect(names).toContain('refresh_root_connection');
    expect(new Set(names).size).toBe(names.length);
    const merged = rootToolDefinitions.map(tool => tool.name);
    expect(new Set(merged).size).toBe(merged.length);
    expect(names.every(name => merged.includes(name))).toBe(true);
    expect(rootAdminResources.every(resource => names.includes(resource.tool))).toBe(true);
    expect(rootAdminToolDefinitions.every(tool => tool.description.includes('API keys cannot use'))).toBe(true);
  });

  it('denies workspace API keys and non-owners before any service call', async () => {
    expect(canUseRootAdminTool({ userId: 'u', isInstanceOwner: true, apiKeyId: 'k' } as never)).toBe(false);
    await expect(callRootAdminTool({ userId: 'u', isInstanceOwner: true, apiKeyId: 'k' } as never, 'list_root_plans', {})).rejects.toMatchObject({ code: 'forbidden' });
    await expect(callRootAdminTool({ userId: 'u', isInstanceOwner: false } as never, 'get_root_backup_status', {})).rejects.toMatchObject({ code: 'forbidden' });
    expect(h.plans.listRootPlans).not.toHaveBeenCalled();
    expect(h.back.readRootBackupStatus).not.toHaveBeenCalled();
  });

  it('dispatches for the installation owner, rejects stray arguments and unknown tools', async () => {
    const viewer = { userId: 'root', isInstanceOwner: true } as never;
    h.plans.updateRootPlan.mockResolvedValue({ changed: true });
    await callRootAdminTool(viewer, 'update_root_plan', { planId: 'p1', patch: { name: 'X' }, confirmation: 'c' });
    expect(h.plans.updateRootPlan).toHaveBeenCalledWith('root', 'p1', { patch: { name: 'X' }, confirmation: 'c' });
    await callRootAdminTool(viewer, 'transfer_root_workspace_ownership', { workspaceId: 'w' });
    expect(h.life.transferWorkspaceOwnership).toHaveBeenCalledWith('root', { workspaceId: 'w' });
    await expect(callRootAdminTool(viewer, 'get_root_backup_status', { force: true })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(callRootAdminTool(viewer, 'run_backup', {})).rejects.toMatchObject({ code: 'not_found' });
    await expect(callRootAdminTool(viewer, 'list_root_plans', [] as never)).rejects.toMatchObject({ code: 'invalid_request' });
  });

  it('offers only the explicitly confirmed account and workspace deletion tools', () => {
    expect(rootAdminToolDefinitions.map(tool => tool.name).filter(name => /backup|restore|delete|purge/.test(name) && !name.startsWith('get_'))).toEqual(['delete_root_unverified_registration', 'delete_root_user', 'delete_root_workspace']); // deliberate, confirmed deletions of disabled accounts and suspended workspaces
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


describe('REST error action confirmation', () => {
  it('requires confirmation and forwards it to the shared service', async () => {
    const request = (body: unknown) => new Request('https://app.example.test/api/root/errors/e1', { method: 'POST', headers: { origin: 'https://app.example.test', 'content-type': 'application/json' }, body: JSON.stringify(body) });
    expect((await resolveError(request({ resolved: true }), ctx('e1'))).status).toBe(400);
    expect(h.errs.setRootErrorResolved).not.toHaveBeenCalled();
    await resolveError(request({ resolved: true, confirmation: 'RESOLVE ROOT ERROR e1' }), ctx('e1'));
    expect(h.errs.setRootErrorResolved).toHaveBeenCalledWith('root', 'e1', true, 'RESOLVE ROOT ERROR e1');
  });
});

describe('MCP error action confirmation', () => {
  it('requires the exact explicit confirmation and rejects stray read arguments', async () => {
    const viewer = { userId: 'root', isInstanceOwner: true } as never;
    await expect(callRootAdminTool(viewer, 'set_root_error_resolved', { id: 'e1', resolved: true })).rejects.toMatchObject({ code: 'invalid_request' });
    expect(h.errs.setRootErrorResolved).not.toHaveBeenCalled();
    await callRootAdminTool(viewer, 'set_root_error_resolved', { id: 'e1', resolved: true, confirmation: 'RESOLVE ROOT ERROR e1' });
    expect(h.errs.setRootErrorResolved).toHaveBeenCalledWith('root', 'e1', true, 'RESOLVE ROOT ERROR e1');
    await expect(callRootAdminTool(viewer, 'get_root_error', { id: 'e1', extra: true })).rejects.toMatchObject({ code: 'invalid_request' });
  });
});

describe('registration MCP service parity', () => {
  const viewer = { userId: 'root', isInstanceOwner: true, maxResultItems: 7 } as never;
  const writes = [
    ['revoke_root_invitation', { workspaceId: 'w1', invitationId: 'i1', confirmation: 'REVOKE INVITATION i1' }],
    ['resend_root_registration_verification', { userId: 'u1', confirmation: 'RESEND VERIFICATION u1' }],
    ['delete_root_unverified_registration', { userId: 'u1', confirmation: 'DELETE UNVERIFIED ACCOUNT u1' }],
  ] as const;

  it('declares strict schemas and explicit read/write hints', () => {
    expect(rootAdminToolDefinitions.find(t => t.name === 'list_root_registration')).toMatchObject({ annotations: { readOnlyHint: true }, inputSchema: { additionalProperties: false } });
    for (const [name] of writes) expect(rootAdminToolDefinitions.find(t => t.name === name)).toMatchObject({ annotations: { readOnlyHint: false, destructiveHint: true }, inputSchema: { additionalProperties: false, required: expect.arrayContaining(['confirmation']) } });
  });

  it('dispatches scoped writes and bounded reads to the HTTP service', async () => {
    const { GET } = await import('../src/app/api/root/registration/route');
    const filters = { q: 'example', workspaceId: 'w1', status: 'pending', page: '2', accountsPage: '3' };
    const receipt = { openRegistration: false, invitations: [], accounts: [], moreInvitations: false, moreAccounts: false };
    h.registration.listRootRegistration.mockResolvedValue(receipt);
    expect((await GET(get(`${url}?${new URLSearchParams(filters)}`), undefined)).status).toBe(200);
    expect(h.registration.listRootRegistration).toHaveBeenLastCalledWith('root', filters);
    expect(await callRootAdminTool(viewer, 'list_root_registration', filters)).toBe(receipt);
    expect(h.registration.listRootRegistration).toHaveBeenLastCalledWith('root', filters, 7);
    for (const [name, args] of writes) await callRootAdminTool(viewer, name, args);
    expect(h.registration.revokeRootRegistrationInvitation).toHaveBeenCalledWith('root', 'w1', 'i1', { confirmation: 'REVOKE INVITATION i1' });
    expect(h.registration.controlRootRegistrationAccount.mock.calls).toEqual([
      ['root', 'u1', 'resend', { confirmation: 'RESEND VERIFICATION u1' }],
      ['root', 'u1', 'delete', { confirmation: 'DELETE UNVERIFIED ACCOUNT u1' }],
    ]);
  });

  it.each(writes)('rejects invalid confirmations and arguments for %s before dispatch', async (name, args) => {
    const { confirmation, ...without } = args;
    for (const input of [without, { ...args, confirmation: 'yes' }, { ...args, confirmation: confirmation.toLowerCase() }, { ...args, confirmation: `${confirmation} ` }, { ...args, confirmation: confirmation.replace(/ (i1|u1)$/, ' other') }, { ...args, force: true }]) await expect(callRootAdminTool(viewer, name, input)).rejects.toMatchObject({ code: 'invalid_request' });
    for (const field of Object.keys(without)) for (const value of [null, 1, '', 'x'.repeat(256), 'bad\nidentifier']) await expect(callRootAdminTool(viewer, name, { ...args, [field]: value })).rejects.toMatchObject({ code: 'invalid_request' });
    expect(h.registration.revokeRootRegistrationInvitation).not.toHaveBeenCalled();
    expect(h.registration.controlRootRegistrationAccount).not.toHaveBeenCalled();
  });

  it('denies non-Root and workspace-key identities for all four tools before services', async () => {
    for (const actor of [{ userId: 'member', isInstanceOwner: false }, { userId: 'root', isInstanceOwner: true, apiKeyId: 'key' }]) {
      for (const [name, args] of [['list_root_registration', {}], ...writes] as const) await expect(callRootAdminTool(actor, name, args)).rejects.toMatchObject({ code: 'forbidden' });
    }
    for (const fn of Object.values(h.registration)) expect(fn).not.toHaveBeenCalled();
  });
});


describe('connection refresh HTTP/MCP parity', () => {
  it('shares the exact scoped service and safe outcome receipt', async () => {
    const { POST } = await import('../src/app/api/root/connections/[id]/refresh/route');
    const receipt = { socialAccountId: 'c1', workspaceId: 'w1', outcome: 'not_renewable', tokenExpiresAt: null };
    h.refreshConnection.mockResolvedValue(receipt);
    const args = { socialAccountId: 'c1', confirmation: 'REFRESH CONNECTION c1' };
    expect(await (await POST(post({ confirmation: args.confirmation }), ctx('c1'))).json()).toEqual({ ok: true, ...receipt });
    expect(h.refreshConnection).toHaveBeenLastCalledWith('root', args);
    expect(await callRootAdminTool({ userId: 'root', isInstanceOwner: true }, 'refresh_root_connection', args)).toEqual(receipt);
    expect(h.refreshConnection).toHaveBeenLastCalledWith('root', args);
    expect(rootAdminToolDefinitions.find(t => t.name === 'refresh_root_connection')).toMatchObject({ annotations: { readOnlyHint: false }, inputSchema: { additionalProperties: false, required: ['socialAccountId', 'confirmation'] } });
  });
  it('enforces HTTP authentication, origin and strict bodies before the service', async () => {
    const { POST } = await import('../src/app/api/root/connections/[id]/refresh/route');
    expect((await POST(post({}, 'https://evil.test'), ctx('c1'))).status).toBe(403);
    h.actor.mockResolvedValueOnce(null);
    expect((await POST(post({}), ctx('c1'))).status).toBe(401);
    h.actor.mockResolvedValueOnce({ id: 'member', isInstanceOwner: false });
    expect((await POST(post({}), ctx('c1'))).status).toBe(404);
    expect((await POST(post({ confirmation: 'REFRESH CONNECTION c1', force: true }), ctx('c1'))).status).toBe(400);
    expect(h.refreshConnection).not.toHaveBeenCalled();
  });
  it('rejects workspace-key and non-Root MCP identities before service dispatch', async () => {
    for (const actor of [{ userId: 'member', isInstanceOwner: false }, { userId: 'root', isInstanceOwner: true, apiKeyId: 'key' }]) {
      await expect(callRootAdminTool(actor, 'refresh_root_connection', {})).rejects.toMatchObject({ code: 'forbidden' });
    }
    expect(h.refreshConnection).not.toHaveBeenCalled();
  });
});
