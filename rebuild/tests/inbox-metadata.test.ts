import { describe, expect, it, vi } from 'vitest';
import { baselineBlock } from './baseline-block';
import { inboxMetadata, readInboxMetadata, storeInboxMetadata } from '../src/modules/inbox/server/metadata';

const scope = { workspaceId: 'workspace-1', targetId: 'channel-1' };
const complete = {
  participants: [{ id: 'visitor-1', name: 'Sam', pictureUrl: 'https://example.test/avatar.jpg' }],
  authorPictureUrl: 'https://example.test/avatar.jpg',
  attachments: [{ type: 'image', url: 'https://example.test/photo.jpg' }, { type: 'file', url: null }],
  reactions: [{ type: 'LIKE', count: 3 }], permalink: 'https://example.test/comment',
  threadId: 'thread-1', labels: [{ id: 'label-1', name: 'Support' }], folder: 'inbox',
};

describe('neutral Inbox metadata', () => {
  it('retains complete observations without inferring absent values', () => {
    expect(inboxMetadata(complete)).toEqual(complete);
    expect(inboxMetadata({ attachments: [], reactions: [], labels: [], folder: null })).toEqual({ attachments: [], reactions: [], labels: [], folder: null });
    expect(inboxMetadata(null)).toBeUndefined();
    expect(inboxMetadata({})).toBeUndefined();
    expect(inboxMetadata({ attachments: 'unknown', reactions: [{ type: 'LIKE', count: -1 }], permalink: complete.permalink, secret: 'discard' })).toEqual({ permalink: complete.permalink });
  });

  it.each(['conversation', 'message', 'comment'] as const)('merges %s metadata within tenant/channel scope without clearing unfetched fields', async kind => {
    const tx = { $executeRaw: vi.fn().mockResolvedValue(1), $queryRaw: vi.fn() };
    await storeInboxMetadata(tx, scope, kind, 'stored-1', complete);
    const [parts, ...values] = tx.$executeRaw.mock.calls[0]! as unknown as [TemplateStringsArray, ...unknown[]];
    const sql = parts.join('?');
    expect(sql).toContain('COALESCE(');
    expect(sql).toContain('||');
    expect(sql).toContain('t."workspaceId" =');
    expect(sql).toContain('t.id =');
    if (kind === 'comment') expect(sql).toContain('p."workspaceId" =');
    expect(values).toContain(scope.workspaceId);
    expect(values).toContain(scope.targetId);
    expect(values).toContain('stored-1');
    expect(JSON.parse(values[0] as string)).toEqual(complete);
    tx.$executeRaw.mockClear();
    await storeInboxMetadata(tx, scope, kind, 'stored-1', undefined);
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });

  it.each(['conversation', 'message', 'comment'] as const)('reads %s observations through the authorized scope and validates stored JSON', async kind => {
    const db = { $executeRaw: vi.fn(), $queryRaw: vi.fn().mockResolvedValue([{ id: 'stored-1', metadata: complete }, { id: 'legacy-1', metadata: null }]) };
    const result = await readInboxMetadata(db, { workspaceId: scope.workspaceId, channelIds: [scope.targetId] }, kind, ['stored-1', 'legacy-1']);
    expect(result.get('stored-1')).toEqual(complete);
    expect(result.has('legacy-1')).toBe(false);
    const [query] = db.$queryRaw.mock.calls[0]! as unknown as [{ sql: string; values: unknown[] }];
    expect(query.sql).toContain('t."workspaceId" =');
    expect(query.sql).toContain('t.id IN');
    if (kind === 'comment') expect(query.sql).toContain('p."workspaceId" =');
    expect(query.values).toEqual(expect.arrayContaining([scope.workspaceId, scope.targetId, 'stored-1']));
    db.$queryRaw.mockClear();
    expect(await readInboxMetadata(db, { workspaceId: scope.workspaceId, channelIds: [] }, kind, ['stored-1'])).toEqual(new Map());
    expect(db.$queryRaw).not.toHaveBeenCalled();
  });

  it('pins the additive migration checksum and preserves unknown metadata for existing rows', () => {
    const migration = baselineBlock('20261031170000_rebuild_inbox_metadata');
    for (const table of ['conversations', 'conversation_messages', 'post_comments']) expect(migration).toContain(`ALTER TABLE ${table} ADD COLUMN "inboxMetadata" JSONB;`);
    expect(migration).not.toMatch(/DROP|DEFAULT|NOT NULL/);
  });
});
