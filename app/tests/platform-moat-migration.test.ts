import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const DIR = 'prisma/migrations/20261103050000_platform_moat';
const migration = readFileSync(`${DIR}/migration.sql`, 'utf8');

describe('platform-moat migration', () => {
  it('sorts after the engagement-alerts migration', () => {
    const names = readdirSync('prisma/migrations').filter(name => name !== 'migration_lock.toml').sort();
    expect(names).toContain('20261103050000_platform_moat');
    expect(names.indexOf('20261103050000_platform_moat')).toBeGreaterThan(names.indexOf('20261103040000_engagement_alerts'));
  });

  it('is additive only: four new tables and indexes, no rewrites', () => {
    expect(migration).toContain('CREATE TABLE "meta_webhook_deliveries"');
    expect(migration).toContain('CREATE TABLE "analytics_rollup_daily"');
    expect(migration).toContain('CREATE TABLE "analytics_rollup_weekly"');
    expect(migration).toContain('CREATE TABLE "analytics_rollup_runs"');
    expect(migration).toContain('CREATE UNIQUE INDEX "analytics_rollup_daily_target_uniq" ON "analytics_rollup_daily"("targetId", "metric", "period", "day")');
    expect(migration).toContain('CREATE UNIQUE INDEX "analytics_rollup_weekly_target_uniq" ON "analytics_rollup_weekly"("targetId", "metric", "period", "weekStart")');
    expect(migration).not.toMatch(/DROP\s+(TABLE|COLUMN|INDEX)/i);
    expect(migration).not.toMatch(/UPDATE\s+"/i);
    expect(migration).not.toMatch(/DELETE\s+FROM/i);
    expect(migration).not.toMatch(/RENAME/i);
    expect(migration).not.toMatch(/ALTER\s+TABLE\s+"(?!analytics_rollup|meta_webhook)/i);
  });

  it('keeps rollup rows inside the workspace boundary and purge gate', () => {
    expect(migration).toContain('FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE');
    expect(migration).toContain('FOREIGN KEY ("targetId") REFERENCES "targets"("id") ON DELETE CASCADE');
    expect(migration).toContain('CREATE TRIGGER rebuild_workspace_purge_write_gate BEFORE INSERT OR UPDATE ON "analytics_rollup_daily"');
    expect(migration).toContain('CREATE TRIGGER rebuild_workspace_purge_write_gate BEFORE INSERT OR UPDATE ON "analytics_rollup_weekly"');
    expect(migration).toContain('CREATE TRIGGER rebuild_workspace_purge_write_gate BEFORE INSERT OR UPDATE ON "analytics_rollup_runs"');
    // The delivery log is installation operational history, not workspace data: no workspace FK, no purge trigger.
    const deliveries = migration.slice(migration.indexOf('CREATE TABLE "meta_webhook_deliveries"'), migration.indexOf('CREATE TABLE "analytics_rollup_daily"'));
    expect(deliveries).not.toContain('workspaceId');
    expect(deliveries).not.toContain('purge_write_gate');
  });

  it('constrains delivery outcomes, rollup kinds and run states', () => {
    expect(migration).toContain(`"status" IN ('accepted', 'duplicate', 'unmatched', 'ignored')`);
    expect(migration).toContain(`"eventKind" IN ('feed_post', 'feed_comment', 'message', 'unknown')`);
    expect(migration).toContain(`"kind" IN ('flow', 'stock')`);
    expect(migration).toContain(`"granularity" IN ('daily', 'weekly')`);
    expect(migration).toContain(`"status" IN ('completed', 'partial', 'failed')`);
  });
});
