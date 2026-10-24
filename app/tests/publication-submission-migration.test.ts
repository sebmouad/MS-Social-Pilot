import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BASELINE_NAME, BASELINE_SHA256, baselineBlock } from './baseline-block';

const migration = baselineBlock('20261019050000_rebuild_publication_submissions');
const deploy = readFileSync('scripts/deploy.sh', 'utf8');

describe('publication submission migration', () => {
  it('adds submitted as a strict provider receipt while preserving other state branches', () => {
    expect(migration).toContain("'attested_absent', 'submitted'");
    expect(migration).toContain("'external_human_attestation', 'provider_submission'");
    expect(migration).toContain("\"state\" = 'submitted' AND \"reason\" = 'provider_submission' AND \"remotePostId\" IS NOT NULL AND \"receiptAt\" IS NOT NULL AND \"projectedAt\" IS NULL AND \"attestedAt\" IS NULL AND \"attestedBy\" IS NULL");
    expect(migration).not.toMatch(/DROP\s+(TABLE|INDEX)|DELETE\s+FROM/i);
    expect(migration).not.toContain('CREATE UNIQUE INDEX');
  });

  it('pins the baseline checksum in deploy.sh', () => {
    expect(deploy).toContain(`BASELINE=${BASELINE_NAME}`);
    expect(deploy).toContain(`BASELINE_SHA256=${BASELINE_SHA256}`);
  });
});
