import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const rehearsal = readFileSync('scripts/cutover-rehearsal.sh', 'utf8');
const migration = readFileSync('../prisma/migrations/20261019020000_rebuild_destination_formats/migration.sql', 'utf8');
const hash = createHash('sha256').update(migration).digest('hex');

describe('destination format migration rehearsal guards', () => {
  it('pins and applies the immutable additive migration after its prerequisites', () => {
    expect(hash).toBe('30325cdda1951cde93fab77a12bc349caa4422861fe133f68320ac3b979af6c6');
    expect(rehearsal).toContain(`verify_migration 20261019020000_rebuild_destination_formats ${hash}`);
    expect(rehearsal).toContain('20261019011000_rebuild_report_purge_gate,20261019020000_rebuild_destination_formats');
    const apply = rehearsal.indexOf('migration_dir/20261019020000_rebuild_destination_formats/migration.sql');
    expect(apply).toBeGreaterThan(rehearsal.indexOf('migration_dir/20261019011000_rebuild_report_purge_gate/migration.sql'));
    expect(apply).toBeLessThan(rehearsal.indexOf('Required tables/columns are taken'));
    expect(migration).toContain('ALTER TABLE post_targets ADD COLUMN "formatId" text');
    expect(migration).toContain('char_length("formatId") BETWEEN 1 AND 128');
    expect(migration).toContain('ALTER TABLE post_versions ADD COLUMN "destinationFormats" jsonb NOT NULL DEFAULT');
    expect(migration).toContain('CHECK (jsonb_typeof("destinationFormats") = \'object\')');
    expect(migration).not.toMatch(/DROP\s+(COLUMN|TABLE)|UPDATE\s+(posts|post_targets|post_versions)/i);
  });

  it('refuses a partially migrated baseline and verifies both new mapped columns', () => {
    expect(rehearsal).toContain("table_name = 'post_targets' AND column_name = 'formatId'");
    expect(rehearsal).toContain("table_name = 'post_versions' AND column_name = 'destinationFormats'");
    expect(rehearsal).toContain("ARRAY['post_targets','formatId']");
    expect(rehearsal).toContain("ARRAY['post_versions','destinationFormats']");
    expect(rehearsal).toContain('migration_name IN ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)');
    expect(rehearsal).toContain("'20261019011000_rebuild_report_purge_gate', '20261019020000_rebuild_destination_formats'");
  });

  it('keeps deploy and rebuild rollback blocked until the migration and host procedure are reviewed', () => {
    const deploy = readFileSync('../scripts/deploy/rebuild-deploy.sh', 'utf8');
    const rollback = readFileSync('../scripts/deploy/rebuild-rollback.sh', 'utf8');
    expect(deploy).toContain('REBUILD_CUTOVER_BLOCKED');
    expect(deploy).toContain('approved migration plan compatible with legacy rollback');
    expect(rollback).toContain('REBUILD_ROLLBACK_BLOCKED');
    expect(rollback).toMatch(/Database\s+restore is a separate decision/);
    expect(rollback).not.toMatch(/DROP\s+(COLUMN|TABLE)|migrate\s+down/i);
  });
});
