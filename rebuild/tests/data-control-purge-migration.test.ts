import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
const migration = '20261031150000_rebuild_supplementary_purge_gates';
const checksum = 'f3f22b82d60a3bbbbacd5b152b3ceb577a3d39d126fd0ecdc09151e106f09768';
const sql = readFileSync(`../prisma/migrations/${migration}/migration.sql`, 'utf8');
describe('supplementary purge migration (rehearsal pin integration pending)', () => {
  it('has a stable reviewed checksum for the integration owner', () => {
    expect(createHash('sha256').update(sql).digest('hex')).toBe(checksum);
    expect(readFileSync('src/server/data-control/README.md', 'utf8')).toContain(checksum);
  });
  it('gates insert and update, permits deletion and preserves historical orphans', () => {
    expect(sql).toContain('BEFORE INSERT OR UPDATE ON public."OAuthCode"');
    expect(sql).toContain('BEFORE INSERT OR UPDATE ON public.rebuild_channel_profiles');
    expect(sql).not.toMatch(/BEFORE DELETE|ADD CONSTRAINT|DELETE FROM|DROP TABLE/);
    expect(sql.match(/status <> 'completed'/g)).toHaveLength(2);
    expect(sql.match(/ERRCODE = '55000'/g)).toHaveLength(3);
  });
  it('locks workspace before target and rechecks target ownership to serialize with erasure', () => {
    const profile = sql.slice(sql.indexOf('CREATE FUNCTION public.rebuild_reject_purging_channel_profile_write'));
    expect(profile.indexOf('FROM public.workspaces')).toBeLessThan(profile.indexOf('AND "workspaceId" = owner_workspace FOR SHARE'));
    expect(profile).toContain('WHERE "workspaceId" = owner_workspace AND status');
    expect(sql.match(/SET search_path = pg_catalog, public/g)).toHaveLength(2);
    expect(sql).toContain("RAISE EXCEPTION 'Workspace unavailable' USING ERRCODE = '23503'");
  });
});
