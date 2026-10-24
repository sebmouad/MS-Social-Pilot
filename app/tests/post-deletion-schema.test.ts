import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BASELINE_NAME, BASELINE_SHA256, baselineBlock } from './baseline-block';

const schema = readFileSync('prisma/schema.prisma', 'utf8');
const migration = baselineBlock('20261016220000_rebuild_post_deletions');
const deploy = readFileSync('scripts/deploy.sh', 'utf8');
const model = schema.split('model RebuildPostDeletion {')[1]?.split('\n}')[0] ?? '';
const tableDefinition = migration.slice(migration.indexOf('CREATE TABLE'), migration.indexOf('\n);') + 3);

describe('remote post deletion journal schema', () => {
  it('maps a content-free workspace-owned recovery table without post, target or user foreign keys', () => {
    expect(model).toMatch(/workspace\s+Workspace @relation\(fields: \[workspaceId\], references: \[id\], onDelete: Cascade\)/);
    expect(model).toMatch(/localPostIds\s+String\[\]\s+@default\(\[\]\)/);
    expect(model).toMatch(/localPostTargetIds\s+String\[\]\s+@default\(\[\]\)/);
    expect(model).toContain('@@index([workspaceId, targetId, updatedAt])');
    expect(model).toContain('@@index([localPostIds], type: Gin)');
    expect(model).toContain('@@map("rebuild_post_deletions")');
    expect(model).not.toContain('@@unique(');
    expect(model).not.toMatch(/accessToken|refreshToken|message|content/i);
    expect(schema).toContain('postDeletions  RebuildPostDeletion[]');

    expect(migration).toContain('REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE');
    expect(migration).not.toMatch(/REFERENCES "(targets|posts|post_targets|users)"/);
    expect(tableDefinition).not.toMatch(/accessToken|refreshToken|message|content/i);
    expect(migration).toMatch(/CREATE TABLE "rebuild_post_deletions"/);
    expect(migration.match(/CREATE TABLE /g)).toHaveLength(1);
    expect(migration).not.toMatch(/\b(?:ALTER|DROP|TRUNCATE)\s+TABLE\b/i);
    expect(migration).not.toMatch(/\bINSERT\s+INTO\b|\bUPDATE\s+"|\bDELETE\s+FROM\b/i);
  });

  it('enforces a partial identity claim and consistent state, reason and timestamp combinations', () => {
    expect(migration).toContain('WHERE "state" <> \'rejected\'');
    expect(migration).toContain('CREATE INDEX "rebuild_post_deletions_workspaceId_targetId_updatedAt_idx"');
    expect(migration).toContain('USING GIN ("localPostIds")');
    expect(migration).toContain("CHECK (\"state\" IN ('started', 'uncertain', 'remote_confirmed', 'completed', 'rejected'))");
    expect(migration).toContain("'external_not_deleted'");
    expect(migration).toContain("\"state\" = 'started' AND \"reason\" IS NULL AND \"remoteConfirmedAt\" IS NULL AND \"completedAt\" IS NULL");
    expect(migration).toContain("\"state\" = 'uncertain' AND \"reason\" = 'transport_unconfirmed' AND \"remoteConfirmedAt\" IS NULL AND \"completedAt\" IS NULL");
    expect(migration).toContain("\"state\" = 'remote_confirmed' AND \"reason\" = 'local_pending' AND \"remoteConfirmedAt\" IS NOT NULL AND \"completedAt\" IS NULL");
    expect(migration).toContain("\"state\" = 'completed' AND \"reason\" IS NULL AND \"remoteConfirmedAt\" IS NOT NULL AND \"completedAt\" IS NOT NULL");
    expect(migration).toContain("\"state\" = 'rejected' AND \"reason\" IN ('provider_rejected', 'external_not_deleted') AND \"remoteConfirmedAt\" IS NULL AND \"completedAt\" IS NULL");
    expect(migration).toMatch(/CHECK \(\([\s\S]*?\) IS TRUE\)/);
    for (const column of ['createdAt', 'updatedAt']) expect(migration).toContain(`"${column}" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP`);
  });

  it('is pinned inside the checksummed baseline verified by deploy.sh', () => {
    expect(deploy).toContain(`BASELINE=${BASELINE_NAME}`);
    expect(deploy).toContain(`BASELINE_SHA256=${BASELINE_SHA256}`);
  });
});
