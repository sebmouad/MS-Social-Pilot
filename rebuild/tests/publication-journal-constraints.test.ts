import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const schema = readFileSync('prisma/schema.prisma', 'utf8');
const migration = readFileSync('../prisma/migrations/20261017010000_rebuild_publication_attempts/migration.sql', 'utf8');
const rehearsal = readFileSync('scripts/cutover-rehearsal.sh', 'utf8');
const model = schema.split('model PublicationAttempt {')[1]?.split('\n}')[0] ?? '';

describe('publication attempt journal schema', () => {
  it('maps content-free attempts with only workspace lifecycle ownership', () => {
    expect(model).toContain('@@map("rebuild_publication_attempts")');
    expect(model).toContain('workspace    Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)');
    expect(model).toContain('@@index([workspaceId, targetId, updatedAt])');
    expect(model).toContain('@@index([workspaceId, postId, postTargetId])');
    expect(schema).toContain('publicationAttempts PublicationAttempt[]');
    expect(model).not.toMatch(/accessToken|refreshToken|message|content/i);
    expect(migration).toContain('REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE');
    expect(migration).not.toMatch(/REFERENCES "(targets|posts|post_targets|users)"/);
    expect(migration.match(/CREATE TABLE /g)).toHaveLength(1);
    expect(migration).not.toMatch(/\b(?:ALTER|DROP|TRUNCATE)\s+TABLE\b/i);
    expect(migration).not.toMatch(/\bINSERT\s+INTO\b|\bUPDATE\s+"|\bDELETE\s+FROM\b/i);
  });

  it('bounds local identities and permits only consistent NULL-safe state, reason, and receipt combinations', () => {
    for (const column of ['id', 'workspaceId', 'postId', 'postTargetId', 'targetId', 'provider', 'actorId', 'state', 'reason', 'remotePostId', 'remoteUrl', 'receiptAt', 'projectedAt', 'attestedAt', 'attestedBy', 'createdAt', 'updatedAt']) {
      expect(migration).toContain(`"${column}"`);
    }
    expect(migration).toContain('length("id") BETWEEN 1 AND 2048');
    expect(migration).toContain("CHECK (\"state\" IN ('started', 'uncertain', 'receipt_recorded', 'projected', 'rejected', 'attested_absent'))");
    expect(migration).toContain("CHECK (\"reason\" IS NULL OR \"reason\" IN ('provider_rejected', 'outcome_unknown', 'provider_receipt', 'external_human_attestation'))");
    expect(migration).toContain("\"state\" = 'started' AND \"reason\" IS NULL");
    expect(migration).toContain("\"state\" = 'uncertain' AND \"reason\" = 'outcome_unknown'");
    expect(migration).toContain("\"state\" = 'receipt_recorded' AND \"reason\" IN ('provider_receipt', 'external_human_attestation')");
    expect(migration).toContain("\"state\" = 'projected' AND \"reason\" IN ('provider_receipt', 'external_human_attestation')");
    expect(migration).toContain("\"state\" = 'rejected' AND \"reason\" = 'provider_rejected'");
    expect(migration).toContain("\"state\" = 'attested_absent' AND \"reason\" = 'external_human_attestation'");
    expect(migration).toMatch(/CHECK \(\([\s\S]*?\) IS TRUE\)/);
  });

  it('holds one non-resolved attempt per workspace destination and pins the additive migration', () => {
    expect(migration).toContain('CREATE UNIQUE INDEX "rebuild_publication_attempts_active_postTarget_key"');
    expect(migration).toContain('ON "rebuild_publication_attempts"("workspaceId", "postTargetId")');
    expect(migration).toContain("WHERE \"state\" NOT IN ('rejected', 'attested_absent')");
    const checksum = createHash('sha256').update(migration).digest('hex');
    expect(rehearsal).toContain(`verify_migration 20261017010000_rebuild_publication_attempts ${checksum}`);
    expect(rehearsal).toContain('20261017010000_rebuild_publication_attempts');
  });
});
