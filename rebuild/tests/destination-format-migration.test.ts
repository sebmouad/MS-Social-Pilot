import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BASELINE_NAME, BASELINE_SHA256, baselineBlock } from './baseline-block';

const rehearsal = readFileSync('scripts/cutover-rehearsal.sh', 'utf8');
const migration = baselineBlock('20261019020000_rebuild_destination_formats');

describe('destination format migration rehearsal guards', () => {
  it('ships inside the pinned baseline applied before the mapped-column checks', () => {
    expect(rehearsal).toContain(`verify_migration ${BASELINE_NAME} ${BASELINE_SHA256}`);
    const apply = rehearsal.indexOf(`migration_dir/${BASELINE_NAME}/migration.sql`);
    expect(apply).toBeGreaterThan(-1);
    expect(apply).toBeLessThan(rehearsal.indexOf('Required tables/columns are taken'));
    expect(migration).toContain('ALTER TABLE post_targets ADD COLUMN "formatId" text');
    expect(migration).toContain('char_length("formatId") BETWEEN 1 AND 128');
    expect(migration).toContain('ALTER TABLE post_versions ADD COLUMN "destinationFormats" jsonb NOT NULL DEFAULT');
    expect(migration).toContain('CHECK (jsonb_typeof("destinationFormats") = \'object\')');
    expect(migration).not.toMatch(/DROP\s+(COLUMN|TABLE)|UPDATE\s+(posts|post_targets|post_versions)/i);
  });

  it('verifies both new mapped columns after the baseline apply', () => {
    expect(rehearsal).toContain("ARRAY['post_targets','formatId']");
    expect(rehearsal).toContain("ARRAY['post_versions','destinationFormats']");
  });

  it('releases through prod-deploy with baseline resolve handling, not the retired pre-cutover blocks', () => {
    const deploy = readFileSync('scripts/prod-deploy.sh', 'utf8');
    expect(deploy).toContain('BASELINE=20261103000000_baseline');
    expect(deploy).toContain('marked applied (');
    expect(deploy).toContain('DEPLOY OK');
    expect(deploy).not.toMatch(/REBUILD_CUTOVER_BLOCKED|REBUILD_ROLLBACK_BLOCKED/);
  });
});
