import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const DIR = 'prisma/migrations/20261103040000_engagement_alerts';
const migration = readFileSync(`${DIR}/migration.sql`, 'utf8');

describe('engagement batch migration', () => {
  it('sorts after the autopilot/variants/link-cache migration', () => {
    const names = readdirSync('prisma/migrations').filter(name => name !== 'migration_lock.toml').sort();
    expect(names).toContain('20261103040000_engagement_alerts');
    expect(names.indexOf('20261103040000_engagement_alerts')).toBeGreaterThan(names.indexOf('20261103030000_autopilot_variants_linkcache'));
  });

  it('is additive only: new tables, columns and indexes, no rewrites', () => {
    expect(migration).toContain('CREATE TABLE "metric_alert_rules"');
    expect(migration).toContain('CREATE TABLE "metric_alert_firings"');
    expect(migration).toContain('ADD COLUMN "onMetricAlert" BOOLEAN NOT NULL DEFAULT true');
    expect(migration).toContain('ADD COLUMN "onReportDelivered" BOOLEAN NOT NULL DEFAULT true');
    expect(migration).toContain('ADD COLUMN "onTriageAssigned" BOOLEAN NOT NULL DEFAULT true');
    expect(migration).toContain('CREATE INDEX "conversation_messages_fts_idx"');
    expect(migration).toContain('CREATE INDEX "post_comments_fts_idx"');
    expect(migration).not.toMatch(/DROP\s+(TABLE|COLUMN|INDEX)/i);
    expect(migration).not.toMatch(/UPDATE\s+"/i);
    expect(migration).not.toMatch(/DELETE\s+FROM/i);
    expect(migration).not.toMatch(/RENAME/i);
  });

  it('keeps every new workspace row inside the workspace boundary and purge gate', () => {
    expect(migration).toContain('REFERENCES "workspaces"("id") ON DELETE CASCADE');
    expect(migration).toContain('FOREIGN KEY ("targetId") REFERENCES "targets"("id") ON DELETE CASCADE');
    expect(migration).toContain('FOREIGN KEY ("ruleId") REFERENCES "metric_alert_rules"("id") ON DELETE CASCADE');
    expect(migration).toContain('FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL');
    expect(migration).toContain('CREATE TRIGGER rebuild_workspace_purge_write_gate BEFORE INSERT OR UPDATE ON "metric_alert_rules"');
    expect(migration).toContain('CREATE TRIGGER rebuild_workspace_purge_write_gate BEFORE INSERT OR UPDATE ON "metric_alert_firings"');
  });

  it('constrains metrics, operators, windows and a single open firing per rule', () => {
    expect(migration).toContain(`"metric" IN ('followers', 'views', 'engagements', 'posts')`);
    expect(migration).toContain(`"operator" IN ('above', 'below')`);
    expect(migration).toContain('"windowDays" IN (7, 30)');
    expect(migration).toContain('CREATE UNIQUE INDEX "metric_alert_firings_open_rule_uniq" ON "metric_alert_firings"("ruleId") WHERE "state" = \'fired\'');
    expect(migration).toContain(`to_tsvector('simple'`);
  });
});
