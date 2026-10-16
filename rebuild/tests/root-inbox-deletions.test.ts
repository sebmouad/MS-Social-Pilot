import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const deps = vi.hoisted(() => ({
  active: true,
  row: null as null | { id: string; workspaceId: string; targetId: string; localItemId: string; state: string },
  rawQueries: [] as string[],
  executeQueries: [] as string[],
  locks: [] as string[],
  audits: 0,
  updates: 0,
  auditFails: false,
  stateAfterLock: null as string | null,
  disableRootAfterLock: false,
  listRows: [] as unknown[],
  prisma: {} as Record<string, unknown>,
}));

function textOf(strings: TemplateStringsArray) { return Array.from(strings).join('?'); }
vi.mock('../src/server/data', () => ({ get prisma() { return deps.prisma; } }));
vi.mock('../src/server/config/store', () => ({ runtimeConfig: async (key: string) => key === 'inbox.deletionHistoryLimit' ? 25 : key === 'root.operationalTimezone' ? 'UTC' : 30000 }));
vi.mock('../src/server/data-control/guard', () => ({ withWorkspaceOperation: async (workspaceId: string, callback: () => Promise<unknown>) => { deps.locks.push(`workspace:${workspaceId}`); return callback(); } }));
vi.mock('../src/modules/inbox/server/comment-guard', () => ({ withInboxChannelOperation: async (workspaceId: string, targetId: string, callback: () => Promise<unknown>) => { deps.locks.push(`channel:${workspaceId}:${targetId}`); if (deps.row && deps.stateAfterLock) deps.row.state = deps.stateAfterLock; if (deps.disableRootAfterLock) deps.active = false; return callback(); } }));
vi.mock('../src/server/root/operations', () => ({ requireActiveRoot: async () => { if (!deps.active) throw Object.assign(new Error('Installation-owner access is required.'), { code: 'forbidden' }); } }));

import { confirmRootInboxDeletion, listRootInboxDeletions } from '../src/server/root/inbox-deletions';

function setup(row = { id: 'op_1', workspaceId: 'ws_1', targetId: 'target_1', localItemId: 'comment_1', state: 'uncertain' }) {
  deps.active = true; deps.row = { ...row }; deps.rawQueries = []; deps.executeQueries = []; deps.locks = []; deps.audits = 0; deps.updates = 0; deps.auditFails = false; deps.stateAfterLock = null; deps.disableRootAfterLock = false; deps.listRows = [];
  const raw = async (strings: TemplateStringsArray) => {
    const text = textOf(strings); deps.rawQueries.push(text);
    if (text.includes('FROM rebuild_inbox_deletions') && text.includes('WHERE id = ?') && !text.includes('FOR UPDATE')) return deps.row ? [{ ...deps.row, remoteConfirmedAt: null, completedAt: null }] : [];
    if (text.includes('FROM users WHERE id = ?')) return [{ isInstanceOwner: true, disabledAt: null }];
    if (text.includes('FOR UPDATE')) return deps.row ? [{ ...deps.row }] : [];
    return deps.listRows;
  };
  const execute = async (strings: TemplateStringsArray) => {
    const text = textOf(strings);
    deps.executeQueries.push(text);
    if (text.includes('UPDATE rebuild_inbox_deletions')) deps.updates++;
    if (text.includes('INSERT INTO root_activities')) { if (deps.auditFails) throw new Error('audit unavailable'); deps.audits++; }
    return 1;
  };
  deps.prisma = {
    $queryRaw: raw,
    $transaction: async (callback: (tx: Record<string, unknown>) => Promise<unknown>) => {
      const before = deps.row && { ...deps.row }; const audits = deps.audits;
      const tx = {
        $queryRaw: async (strings: TemplateStringsArray) => {
          const text = textOf(strings); deps.rawQueries.push(text);
          if (text.includes('FROM users WHERE id = ?')) return [{ isInstanceOwner: true, disabledAt: null }];
          if (text.includes('FOR UPDATE')) return deps.row ? [{ ...deps.row }] : [];
          return [];
        },
        $executeRaw: execute,
      };
      try {
        const result = await callback(tx);
        if (deps.row && deps.updates) deps.row.state = 'remote_confirmed';
        return result;
      } catch (error) { deps.row = before; deps.audits = audits; throw error; }
    },
  };
}

describe('Root Inbox deletion recovery', () => {
  beforeEach(() => setup());
  afterEach(() => vi.unstubAllGlobals());

  it('lists bounded safe fields without remote identity, provider errors, actor or content', async () => {
    setup();
    deps.listRows = [{ id: 'op_1', workspaceId: 'ws_1', targetId: 'target_1', localItemId: 'comment_1', state: 'uncertain', createdAt: new Date('2026-10-01T00:00:00Z'), updatedAt: new Date('2026-10-02T00:00:00Z'), remoteConfirmedAt: null, completedAt: null, workspaceName: 'Workspace', targetName: 'Channel', provider: 'facebook', remoteId: 'remote-opaque-id', actorId: 'private-actor', reason: 'token failure', message: 'customer content' }];
    const listed = await listRootInboxDeletions('root_1');
    expect(listed.items).toEqual([{ operationId: 'op_1', workspaceId: 'ws_1', workspaceName: 'Workspace', targetId: 'target_1', targetName: 'Channel', provider: 'facebook', remoteObjectId: 'remote-opaque-id', localItemId: 'comment_1', state: 'uncertain', createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-02T00:00:00.000Z', remoteConfirmedAt: null, completedAt: null }]);
    expect(JSON.stringify(listed)).not.toMatch(/private-actor|token failure|customer content/);
    expect(deps.rawQueries[0]).toContain('LIMIT ?');
  });

  it('rechecks current Root authority and confirms only the exact still-uncertain operation under both locks', async () => {
    const provider = vi.fn(); vi.stubGlobal('fetch', provider);
    const result = await confirmRootInboxDeletion('root_1', { operationId: 'op_1', confirmation: 'CONFIRM REMOTE DELETION op_1', verifiedOnPlatform: true });
    expect(result).toEqual({ ok: true, operationId: 'op_1', workspaceId: 'ws_1', targetId: 'target_1', localItemId: 'comment_1', state: 'remote_confirmed' });
    expect(deps.locks).toEqual(['workspace:ws_1', 'channel:ws_1:target_1']);
    expect(deps.updates).toBe(1); expect(deps.audits).toBe(1); expect(deps.row?.state).toBe('remote_confirmed');
    expect(deps.rawQueries.some(query => query.includes('FROM users WHERE id = ?'))).toBe(true);
    expect(deps.executeQueries.some(query => query.includes("reason = 'local_pending'"))).toBe(true);
    expect(deps.executeQueries.some(query => query.includes('operator_verified_local_pending'))).toBe(false);
    expect(provider).not.toHaveBeenCalled();
  });

  it('rejects inactive Root before touching the journal', async () => {
    deps.active = false;
    await expect(confirmRootInboxDeletion('root_1', { operationId: 'op_1', confirmation: 'CONFIRM REMOTE DELETION op_1', verifiedOnPlatform: true })).rejects.toMatchObject({ code: 'forbidden' });
    expect(deps.rawQueries).toEqual([]); expect(deps.locks).toEqual([]);
  });

  it('rechecks Root authority after acquiring workspace and channel locks', async () => {
    deps.disableRootAfterLock = true;
    await expect(confirmRootInboxDeletion('root_1', { operationId: 'op_1', confirmation: 'CONFIRM REMOTE DELETION op_1', verifiedOnPlatform: true })).rejects.toMatchObject({ code: 'forbidden' });
    expect(deps.locks).toEqual(['workspace:ws_1', 'channel:ws_1:target_1']);
    expect(deps.updates).toBe(0); expect(deps.audits).toBe(0);
  });

  it('requires exact confirmation and explicit platform verification', async () => {
    await expect(confirmRootInboxDeletion('root_1', { operationId: 'op_1', confirmation: 'CONFIRM REMOTE DELETION wrong', verifiedOnPlatform: true })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(confirmRootInboxDeletion('root_1', { operationId: 'op_1', confirmation: 'CONFIRM REMOTE DELETION op_1', verifiedOnPlatform: false })).rejects.toMatchObject({ code: 'invalid_request' });
    expect(deps.locks).toEqual([]);
  });

  it('rechecks current state after lock acquisition and atomically rolls back if audit fails', async () => {
    deps.stateAfterLock = 'remote_confirmed';
    await expect(confirmRootInboxDeletion('root_1', { operationId: 'op_1', confirmation: 'CONFIRM REMOTE DELETION op_1', verifiedOnPlatform: true })).rejects.toMatchObject({ code: 'conflict' });
    expect(deps.locks).toEqual(['workspace:ws_1', 'channel:ws_1:target_1']);
    expect(deps.updates).toBe(0); expect(deps.audits).toBe(0);
    setup(); deps.auditFails = true;
    await expect(confirmRootInboxDeletion('root_1', { operationId: 'op_1', confirmation: 'CONFIRM REMOTE DELETION op_1', verifiedOnPlatform: true })).rejects.toThrow('audit unavailable');
    expect(deps.row?.state).toBe('uncertain'); expect(deps.audits).toBe(0); expect(deps.updates).toBe(1);
  });
});
