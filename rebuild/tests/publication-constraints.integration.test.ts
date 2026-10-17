import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Prisma, PrismaClient } from '../generated/client';

const databaseUrl = process.env.REBUILD_PREVIEW_DATABASE_URL;
const integration = vi.hoisted(() => ({ prisma: null as unknown as PrismaClient }));
vi.mock('../src/server/data', () => ({ get prisma() { return integration.prisma; } }));

type Attempt = {
  id?: string;
  workspaceId: string;
  postId?: string;
  postTargetId?: string;
  targetId?: string;
  provider?: string;
  actorId?: string;
  state?: string;
  reason?: string | null;
  remotePostId?: string | null;
  remoteUrl?: string | null;
  receiptAt?: Date | null;
  projectedAt?: Date | null;
  attestedAt?: Date | null;
  attestedBy?: string | null;
};

describe.skipIf(!databaseUrl)('publication journal PostgreSQL constraints on isolated preview', () => {
  let client: PrismaClient | undefined;
  const workspaces = new Set<string>();

  beforeAll(() => {
    // Guard both inputs before constructing a client; never fall back to DATABASE_URL implicitly.
    if (process.env.DATABASE_URL !== databaseUrl) throw new Error('Publication constraint integration requires DATABASE_URL to exactly match the guarded preview URL.');
    const url = new URL(databaseUrl!);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      || !decodeURIComponent(url.pathname).endsWith('_preview') || ['host', 'hostaddr', 'socket'].some(key => url.searchParams.has(key))) {
      throw new Error('Publication constraint integration writes require an isolated loopback _preview database.');
    }
    client = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    integration.prisma = client;
  });

  afterEach(async () => {
    if (!client) return;
    for (const workspaceId of workspaces) await client.$executeRaw`DELETE FROM workspaces WHERE id=${workspaceId}`;
    workspaces.clear();
  });
  afterAll(async () => { integration.prisma = client as PrismaClient; await client?.$disconnect(); });

  async function createWorkspace() {
    if (!client) throw new Error('Guarded preview client was not initialized.');
    const id = `preview_publication_${randomUUID().replaceAll('-', '')}`;
    workspaces.add(id);
    await client.workspace.create({ data: { id, name: 'Synthetic publication schema fixture', slug: id, timezone: 'UTC' } });
    return id;
  }

  function attempt(workspaceId: string, override: Partial<Attempt> = {}): Attempt {
    const key = randomUUID();
    return {
      id: randomUUID(), workspaceId, postId: `post-${key}`, postTargetId: `post-target-${key}`,
      targetId: `target-${key}`, provider: 'synthetic-provider', actorId: `actor-${key}`,
      state: 'started', reason: null, remotePostId: null, remoteUrl: null,
      receiptAt: null, projectedAt: null, attestedAt: null, attestedBy: null,
      ...override,
    };
  }

  async function insert(tx: Prisma.TransactionClient | PrismaClient, row: Attempt) {
    await tx.$executeRaw`INSERT INTO rebuild_publication_attempts
      (id, "workspaceId", "postId", "postTargetId", "targetId", provider, "actorId", state, reason, "remotePostId", "remoteUrl", "receiptAt", "projectedAt", "attestedAt", "attestedBy")
      VALUES (${row.id}, ${row.workspaceId}, ${row.postId}, ${row.postTargetId}, ${row.targetId}, ${row.provider}, ${row.actorId}, ${row.state}, ${row.reason ?? null}, ${row.remotePostId ?? null}, ${row.remoteUrl ?? null}, ${row.receiptAt ?? null}, ${row.projectedAt ?? null}, ${row.attestedAt ?? null}, ${row.attestedBy ?? null})`;
  }

  async function expectRejectedInsert(row: Attempt) {
    expect(client).toBeDefined();
    await expect(client!.$transaction(tx => insert(tx, row))).rejects.toBeDefined();
  }

  it('rejects incomplete, mismatched, and NULL-bearing state/receipt/attestation shapes', async () => {
    const workspaceId = await createWorkspace();
    const now = new Date();
    const badRows = [
      attempt(workspaceId, { state: 'started', reason: null, attestedAt: now }),
      attempt(workspaceId, { state: 'started', reason: 'outcome_unknown' }),
      attempt(workspaceId, { state: 'uncertain', reason: null }),
      attempt(workspaceId, { state: 'uncertain', reason: 'provider_rejected' }),
      attempt(workspaceId, { state: 'receipt_recorded', reason: 'provider_receipt', remotePostId: 'remote-1' }),
      attempt(workspaceId, { state: 'receipt_recorded', reason: 'provider_receipt', receiptAt: now }),
      attempt(workspaceId, { state: 'receipt_recorded', reason: 'external_human_attestation', remotePostId: 'remote-2', receiptAt: now, attestedAt: now }),
      attempt(workspaceId, { state: 'projected', reason: 'provider_receipt', remotePostId: 'remote-3', receiptAt: now }),
      attempt(workspaceId, { state: 'projected', reason: 'external_human_attestation', remotePostId: 'remote-4', receiptAt: now, projectedAt: now, attestedBy: 'actor' }),
      attempt(workspaceId, { state: 'rejected', reason: 'provider_rejected', remoteUrl: 'https://example.test/post/1' }),
      attempt(workspaceId, { state: 'attested_absent', reason: 'external_human_attestation', attestedAt: now }),
      attempt(workspaceId, { state: 'not-a-state', reason: null }),
      attempt(workspaceId, { state: 'started', reason: null, postTargetId: 'x'.repeat(2049) }),
    ];
    for (const row of badRows) await expectRejectedInsert(row);

    // SQL CHECK expressions must reject UNKNOWN as well as FALSE.
    const nullReason = attempt(workspaceId, { state: 'uncertain', reason: null });
    await expectRejectedInsert(nullReason);
  });

  it('prevents duplicate active attempts including projected receipts, while allowing rejected and absent history to release a destination', async () => {
    const workspaceId = await createWorkspace();
    const started = attempt(workspaceId);
    await insert(client!, started);
    await expectRejectedInsert(attempt(workspaceId, { postTargetId: started.postTargetId }));

    const projected = attempt(workspaceId, {
      state: 'projected', reason: 'provider_receipt', remotePostId: 'remote-projected',
      receiptAt: new Date(), projectedAt: new Date(),
    });
    await insert(client!, projected);
    await expectRejectedInsert(attempt(workspaceId, { postTargetId: projected.postTargetId }));

    const rejected = attempt(workspaceId, { state: 'rejected', reason: 'provider_rejected' });
    await insert(client!, rejected);
    await insert(client!, attempt(workspaceId, { postTargetId: rejected.postTargetId }));

    const absent = attempt(workspaceId, { state: 'attested_absent', reason: 'external_human_attestation', attestedAt: new Date(), attestedBy: 'external-reviewer' });
    await insert(client!, absent);
    await insert(client!, attempt(workspaceId, { postTargetId: absent.postTargetId }));
  });

  it('requires a workspace but no post, destination, target, or actor row, then cascades journal history with workspace erasure', async () => {
    const workspaceId = await createWorkspace();
    const orphanAliases = attempt(workspaceId);
    await insert(client!, orphanAliases);
    const before = await client!.$queryRaw<Array<{ id: string }>>`SELECT id FROM rebuild_publication_attempts WHERE id=${orphanAliases.id}`;
    expect(before).toHaveLength(1);

    const missingWorkspace = attempt(`missing-${randomUUID()}`);
    await expectRejectedInsert(missingWorkspace);

    await client!.$executeRaw`DELETE FROM workspaces WHERE id=${workspaceId}`;
    workspaces.delete(workspaceId);
    const after = await client!.$queryRaw<Array<{ id: string }>>`SELECT id FROM rebuild_publication_attempts WHERE id=${orphanAliases.id}`;
    expect(after).toHaveLength(0);
  });
});
