import { beforeEach, describe, expect, it, vi } from 'vitest';
const db = vi.hoisted(() => ({ query: vi.fn(), execute: vi.fn(), transaction: vi.fn() }));
vi.mock('@/platforms/instagram/source-binding', () => ({ assertInstagramSource: vi.fn(async () => {}) }));
vi.mock('@/server/data', () => ({ prisma: { $transaction: db.transaction } }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: vi.fn(async key => key === 'instagram.policy' ? (await import('@/platforms/instagram/config')).INSTAGRAM_POLICY_DEFAULTS : 1000) }));
import { instagramContainerJournal } from '@/platforms/instagram/container-journal';
import { createInstagramAdapter } from '@/platforms/instagram/adapter';
import { INSTAGRAM_POLICY_DEFAULTS } from '@/platforms/instagram/config';
import type { PublishRequest } from '@/platforms/types';
const request: PublishRequest = {
  operationId: 'op', publication: { workspaceId: 'workspace', postId: 'post', postTargetId: 'destination', targetId: 'target', actorId: 'owner' },
  credential: { accessToken: 'private', grantedScopes: INSTAGRAM_POLICY_DEFAULTS.publishScopes },
  target: { id: 'remote', name: 'Example', kind: 'instagram' }, text: 'Private caption', media: [{ kind: 'image', url: 'https://example.test/photo.jpg' }],
};
beforeEach(() => {
  vi.clearAllMocks();
  db.transaction.mockImplementation(async work => work({ $queryRaw: db.query, $executeRaw: db.execute }));
  db.query.mockImplementation(async (sql: TemplateStringsArray) => sql.join('').includes('AS blocked') ? [{ blocked: false }] : [{ id: 'op' }]); db.execute.mockResolvedValue(1);
});
describe('Instagram durable publication child intents', () => {
  it('binds the intent to the active tenant, actor, destination and selected connection without storing content', async () => {
    await instagramContainerJournal(request).begin('container', 1);
    const sql = db.query.mock.calls[0]![0].join(' ');
    expect(sql).toContain("a.provider='instagram'");
    expect(sql).toContain("a.state='started'");
    expect(sql).toContain('t.enabled=true');
    expect(db.query.mock.calls[0]!.slice(1)).toEqual(['op', 'workspace', 'target', 'post', 'destination', 'owner', 'remote', false]);
    const audit = db.execute.mock.calls[0]!;
    expect(audit.join(' ')).not.toContain('Private caption');
    expect(audit.join(' ')).not.toContain('photo.jpg');
    expect(audit.join(' ')).not.toContain('private');
  });
  it('refuses absent, cross-workspace or inactive publication claims before writing an intent', async () => {
    db.query.mockResolvedValue([]);
    await expect(instagramContainerJournal(request).begin('publish', 0)).rejects.toMatchObject({ outcome: 'uncertain' });
    expect(db.execute).not.toHaveBeenCalled();
  });
  it('blocks a new attempt after an earlier publish intent even if its parent was attested absent', async () => {
    db.query.mockImplementation(async (sql: TemplateStringsArray) => sql.join('').includes('AS blocked') ? [{ blocked: true }] : [{ id: 'op' }]);
    await expect(instagramContainerJournal(request).begin('container', 1)).rejects.toMatchObject({ outcome: 'uncertain' });
    expect(db.execute).not.toHaveBeenCalled();
  });
  it('requires a publication context before production dispatch', async () => {
    await expect(instagramContainerJournal({ ...request, publication: undefined }).begin('container', 1)).rejects.toMatchObject({ outcome: 'rejected' });
  });
  it('requires an exact started child before recording its receipt', async () => {
    db.execute.mockResolvedValue(0);
    await expect(instagramContainerJournal(request).receipt('publish', 0, 'media')).rejects.toMatchObject({ outcome: 'uncertain' });
  });
  it('orders durable writes before remote mutations and retains final media receipt', async () => {
    const events: string[] = [];
    const responses = [{ id: 'container' }, { status_code: 'FINISHED' }, { id: 'media' }, {}];
    const adapter = createInstagramAdapter({ ...INSTAGRAM_POLICY_DEFAULTS, appSecretProofEnabled: false }, {
      fetch: async () => { events.push('remote'); return new Response(JSON.stringify(responses.shift())); },
      journalFactory: () => ({ begin: async (phase, n) => { events.push(`begin:${phase}:${n}`); }, receipt: async (phase, n, id) => { events.push(`receipt:${phase}:${n}:${id}`); } }),
    });
    expect(await adapter.publish!(request)).toMatchObject({ remoteId: 'media', state: 'published' });
    expect(events).toEqual(['begin:container:1', 'remote', 'receipt:container:1:container', 'remote', 'begin:publish:0', 'remote', 'receipt:publish:0:media', 'remote']);
  });
  it('never dispatches after an existing child intent refuses re-entry', async () => {
    const fetch = vi.fn();
    const adapter = createInstagramAdapter({ ...INSTAGRAM_POLICY_DEFAULTS, appSecretProofEnabled: false }, {
      fetch, journalFactory: () => ({ begin: async () => { throw new Error('duplicate intent'); }, receipt: async () => {} }),
    });
    await expect(adapter.publish!(request)).rejects.toThrow('duplicate intent');
    expect(fetch).not.toHaveBeenCalled();
  });
});
