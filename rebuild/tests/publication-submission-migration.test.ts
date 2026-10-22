import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migrationPath = 'prisma/migrations/20261019050000_rebuild_publication_submissions/migration.sql';
const migration = readFileSync(migrationPath, 'utf8');
const rehearsal = readFileSync('scripts/cutover-rehearsal.sh', 'utf8');

describe('publication submission migration', () => {
  it('adds submitted as a strict provider receipt while preserving other state branches', () => {
    expect(createHash('sha256').update(migration).digest('hex')).toBe('91011f00b776d402038d74ff1862e5ab352bbeb500d386b5000172a17ffb5931');
    expect(migration).toContain("'attested_absent', 'submitted'");
    expect(migration).toContain("'external_human_attestation', 'provider_submission'");
    expect(migration).toContain("\"state\" = 'submitted' AND \"reason\" = 'provider_submission' AND \"remotePostId\" IS NOT NULL AND \"receiptAt\" IS NOT NULL AND \"projectedAt\" IS NULL AND \"attestedAt\" IS NULL AND \"attestedBy\" IS NULL");
    expect(migration).not.toMatch(/DROP\s+(TABLE|INDEX)|DELETE\s+FROM/i);
    expect(migration).not.toContain('CREATE UNIQUE INDEX');
  });

  it('pins, orders, and exercises valid and malformed submitted rows in the scratch rehearsal', () => {
    expect(rehearsal).toContain('verify_migration 20261019050000_rebuild_publication_submissions 91011f00b776d402038d74ff1862e5ab352bbeb500d386b5000172a17ffb5931');
    expect(rehearsal).toContain('20261019040000_rebuild_facebook_native_status_proofs,20261019050000_rebuild_publication_submissions');
    const apply = rehearsal.indexOf('migration_dir/20261019050000_rebuild_publication_submissions/migration.sql');
    expect(apply).toBeGreaterThan(rehearsal.indexOf('migration_dir/20261019040000_rebuild_facebook_native_status_proofs/migration.sql'));
    expect(rehearsal).toContain("'submitted', 'provider_submission', token || 'remote'");
    expect(rehearsal).toContain("workspace_id := token || '_workspace_' || txid_current()::text");
    expect(rehearsal).toContain('INSERT INTO workspaces (id, name, slug, timezone, "createdAt", "updatedAt")');
    expect(rehearsal).not.toContain('submission rehearsal requires a workspace fixture');
    expect(rehearsal).toContain('ROLLBACK;');
    expect(rehearsal).toContain('submitted without provider_submission reason was accepted');
    expect(rehearsal).toContain('submitted without remotePostId was accepted');
    expect(rehearsal).toContain('submitted without receiptAt was accepted');
    expect(rehearsal).toContain('submitted with projectedAt was accepted');
    expect(rehearsal).toContain('submitted with attestation fields was accepted');
    expect(rehearsal).toContain('IF rejected <> 5');
  });
});
