import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { createFacebookNativeScheduleStore } from '../src/platforms/facebook/formats/schedule-journal';

const migration = readFileSync('../prisma/migrations/20261030140000_rebuild_facebook_native_schedule_changes/migration.sql', 'utf8');
const limits = async () => ({ timeout: 1000, maxWait: 1000 });
const scope = { workspaceId: 'ws', publishOperationId: 'pub' };
const video = (operationId: string, over = {}) => ({ operationId, format: 'video' as const, state: 'started' as const, knownIds: ['VID'], targetId: 'page', ...over });

describe('Facebook native schedule-change migration', () => {
  it('binds each change to the native journal, workspace and remote identity', () => {
    expect(migration).toContain('CREATE TABLE "rebuild_facebook_native_schedule_changes"');
    expect(migration).toContain('REFERENCES "rebuild_facebook_native_journal"("workspaceId", "operationId") ON DELETE CASCADE');
    expect(migration).toContain('REFERENCES "workspaces"("id") ON DELETE CASCADE');
    expect(migration).toContain('"changeId" = "publishOperationId" || \':cancel\'');
    expect(migration).toContain('\':reschedule:\' || "scheduledUnix"::text');
    expect(migration).toContain('journal_row."format" <> \'video\'');
    expect(migration).toContain('journal_row."remoteId" IS DISTINCT FROM NEW."remoteId"');
    expect(migration).toContain('journal_row."state" NOT IN (\'published\', \'confirmed\') OR journal_row."conflicted"');
    expect(migration).not.toMatch(/REFERENCES "(posts|post_targets|targets|social_accounts)"/);
  });
  it('is immutable, monotonic and kind-specific, and gated during purge', () => {
    expect(migration).toContain('schedule change binding is immutable');
    expect(migration).toContain('NEW."revision" <> OLD."revision" + 1');
    expect(migration).toContain('NEW."kind" = \'cancel\' AND NEW."state" = \'deleted\'');
    expect(migration).toContain('NEW."kind" = \'reschedule\' AND NEW."state" = \'published\'');
    expect(migration).toContain('rebuild_reject_purging_workspace_write');
    expect(migration).toContain('"state" IN (\'started\', \'published\', \'rejected\', \'uncertain\', \'deleted\')');
    expect(migration).not.toMatch(/\bDROP\b|\bALTER TABLE\b/);
  });
});

describe('Facebook native schedule store request validation', () => {
  const database = () => ({ $transaction: vi.fn(async () => { throw new Error('database must not be reached'); }) });
  const build = (db = database()) => ({ db, store: createFacebookNativeScheduleStore(scope, { database: db as never, limits }) });

  it('refuses malformed scopes and foreign or unsafe change ids before any query', async () => {
    expect(() => createFacebookNativeScheduleStore({ workspaceId: ' ws', publishOperationId: 'pub' })).toThrow();
    expect(() => createFacebookNativeScheduleStore({ workspaceId: 'ws', publishOperationId: 'a\nb' })).toThrow();
    const { db, store } = build();
    for (const id of ['pub:delete', 'other:cancel', 'pub:reschedule:', 'pub:reschedule:0', 'pub:reschedule:-5', 'pub:reschedule:1.5', 'pub:reschedule:1234567890123', 'pub:reschedule:12:x']) {
      await expect(store.begin(video(id))).rejects.toMatchObject({ code: 'conflict' });
      await expect(store.get(id)).rejects.toMatchObject({ code: 'conflict' });
      await expect(store.update(id, { state: 'deleted' })).rejects.toMatchObject({ code: 'conflict' });
    }
    expect(db.$transaction).not.toHaveBeenCalled();
  });
  it('refuses non-video, non-started and pre-identified proposals, and extra patch fields', async () => {
    const { db, store } = build();
    await expect(store.begin(video('pub:cancel', { format: 'reel' }))).rejects.toMatchObject({ code: 'conflict' });
    await expect(store.begin(video('pub:cancel', { state: 'published' }))).rejects.toMatchObject({ code: 'conflict' });
    await expect(store.begin(video('pub:cancel', { knownIds: [] }))).rejects.toMatchObject({ code: 'conflict' });
    await expect(store.begin(video('pub:cancel', { knownIds: ['a', 'b'] }))).rejects.toMatchObject({ code: 'conflict' });
    await expect(store.begin(video('pub:cancel', { remoteId: 'VID' }))).rejects.toMatchObject({ code: 'conflict' });
    await expect(store.begin(video('pub:cancel', { steps: [{ phase: 'video_create', dispatched: true, confirmed: true }] }))).rejects.toMatchObject({ code: 'conflict' });
    await expect(store.update('pub:cancel', { state: 'confirmed' })).rejects.toMatchObject({ code: 'conflict' });
    await expect(store.update('pub:cancel', { state: 'deleted', knownIds: ['x'] })).rejects.toMatchObject({ code: 'conflict' });
    await expect(store.update('pub:cancel', { state: 'deleted', remoteId: 'x' })).rejects.toMatchObject({ code: 'conflict' });
    await expect(store.update('pub', { state: 'confirmed' })).rejects.toMatchObject({ code: 'conflict' });
    await expect(store.update('pub', { state: 'deleted', steps: [] })).rejects.toMatchObject({ code: 'conflict' });
    expect(db.$transaction).not.toHaveBeenCalled();
  });
  it('does not write for a child this instance never created', async () => {
    const { db, store } = build();
    expect(await store.update('pub:cancel', { state: 'deleted' }, ['started'])).toBe(false);
    expect(await store.update('pub:reschedule:1800000000', { state: 'published' })).toBe(false);
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});
