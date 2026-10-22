import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync('prisma/migrations/20261103030000_autopilot_variants_linkcache/migration.sql', 'utf8');

describe('autopilot batch migration', () => {
  it('is additive only: new tables and one nullable column, no rewrites', () => {
    expect(migration).toContain('CREATE TABLE "autopilot_policies"');
    expect(migration).toContain('CREATE TABLE "post_language_variants"');
    expect(migration).toContain('CREATE TABLE "link_preview_cache"');
    expect(migration).toContain('ALTER TABLE "targets" ADD COLUMN "locale" TEXT');
    expect(migration).not.toMatch(/DROP\s+(TABLE|COLUMN)/i);
    expect(migration).not.toMatch(/ALTER TABLE "(posts|targets|workspaces|activity_logs)" DROP/i);
    expect(migration).not.toMatch(/UPDATE\s+"?(posts|targets|workspaces|activity_logs)/i);
    expect(migration).not.toMatch(/DELETE\s+FROM/i);
    expect(migration).not.toMatch(/RENAME/i);
  });

  it('keeps every new workspace row inside the workspace boundary and purge gate', () => {
    expect(migration).toContain('REFERENCES "workspaces"("id") ON DELETE CASCADE');
    expect(migration).toContain('FOREIGN KEY ("postId") REFERENCES "posts"("id") ON DELETE CASCADE');
    expect(migration).toContain('FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL');
    expect(migration).toContain('CREATE TRIGGER rebuild_workspace_purge_write_gate BEFORE INSERT OR UPDATE ON "autopilot_policies"');
    expect(migration).toContain('CREATE TRIGGER rebuild_workspace_purge_write_gate BEFORE INSERT OR UPDATE ON "post_language_variants"');
  });

  it('constrains tiers, locales and cache shape at the database', () => {
    expect(migration).toContain(`"tier" IN ('manual', 'assisted', 'supervised_auto')`);
    expect(migration).toContain(`UNIQUE ("postId", "locale")`);
    expect(migration).toContain(`'^[a-z]{2}(-[A-Z]{2})?$'`);
    expect(migration).toContain('jsonb_typeof("preview")');
  });
});
