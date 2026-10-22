import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BASELINE_NAME, BASELINE_SHA256, baselineBlock } from './baseline-block';

const migration = baselineBlock('20261019050000_rebuild_publication_submissions');
const rehearsal = readFileSync('scripts/cutover-rehearsal.sh', 'utf8');

describe('publication submission migration', () => {
  it('adds submitted as a strict provider receipt while preserving other state branches', () => {
    expect(migration).toContain("'attested_absent', 'submitted'");
    expect(migration).toContain("'external_human_attestation', 'provider_submission'");
    expect(migration).toContain("\"state\" = 'submitted' AND \"reason\" = 'provider_submission' AND \"remotePostId\" IS NOT NULL AND \"receiptAt\" IS NOT NULL AND \"projectedAt\" IS NULL AND \"attestedAt\" IS NULL AND \"attestedBy\" IS NULL");
    expect(migration).not.toMatch(/DROP\s+(TABLE|INDEX)|DELETE\s+FROM/i);
    expect(migration).not.toContain('CREATE UNIQUE INDEX');
  });

  it('pins the baseline and exercises valid and malformed submitted rows in the scratch rehearsal', () => {
    expect(rehearsal).toContain(`verify_migration ${BASELINE_NAME} ${BASELINE_SHA256}`);
    expect(rehearsal).toContain(`migration_dir/${BASELINE_NAME}/migration.sql`);
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
