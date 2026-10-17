import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync('../prisma/migrations/20261017020000_rebuild_facebook_media_steps/migration.sql', 'utf8');

describe('Facebook media step journal migration', () => {
  it('adds a single workspace-owned, content-free journal table', () => {
    expect(migration.match(/CREATE TABLE /g)).toHaveLength(1);
    expect(migration).toContain('CREATE TABLE "rebuild_facebook_media_steps"');
    expect(migration).toContain('REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE');
    expect(migration).not.toMatch(/REFERENCES "(targets|posts|post_targets|users|rebuild_publication_attempts)"/);
    expect(migration).not.toMatch(/accessToken|refreshToken|mediaBytes|mediaUrl|rawResponse|providerError/i);
    expect(migration).not.toMatch(/\b(?:ALTER|DROP|TRUNCATE)\s+TABLE\b/i);
  });

  it('bounds identifiers and uses NULL-safe phase, state, and timestamp constraints', () => {
    for (const column of ['id', 'workspaceId', 'operationId', 'postId', 'postTargetId', 'targetId', 'actorId', 'remoteTargetId', 'phase', 'ordinal', 'state', 'remoteId', 'receiptAt', 'rejectedAt', 'createdAt', 'updatedAt']) {
      expect(migration).toContain(`"${column}"`);
    }
    expect(migration).toContain("CHECK (\"state\" IN ('started', 'recorded', 'rejected', 'uncertain'))");
    expect(migration).toContain("\"phase\" = 'photo' AND \"ordinal\" BETWEEN 1 AND 20");
    expect(migration).toContain("\"phase\" = 'feed' AND \"ordinal\" = 0");
    expect(migration).toMatch(/CHECK \(\([\s\S]*?\) IS TRUE\)/);
    expect(migration).toContain('length("operationId") BETWEEN 1 AND 2048');
    expect(migration).toContain('length("remoteTargetId") BETWEEN 1 AND 2048');
  });

  it('prevents replay of one phase/ordinal and duplicate known media IDs per Page', () => {
    expect(migration).toContain('CREATE UNIQUE INDEX "rebuild_facebook_media_steps_operation_phase_ordinal_key"');
    expect(migration).toContain('ON "rebuild_facebook_media_steps"("operationId", "phase", "ordinal")');
    expect(migration).toContain('CREATE UNIQUE INDEX "rebuild_facebook_media_steps_known_remote_id_key"');
    expect(migration).toContain('ON "rebuild_facebook_media_steps"("workspaceId", "targetId", "phase", "remoteId")');
    expect(migration).toContain('WHERE "remoteId" IS NOT NULL');
  });
});
