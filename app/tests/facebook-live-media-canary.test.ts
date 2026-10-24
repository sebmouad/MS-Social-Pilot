import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acquirePageLock, canFinalizeCompletedRun, cleanupKnownMedia, createFileJournal, finalizeCompletedRun, generatePngFixture, releasePageLock, safePhotoState, validPngSignature } from '../scripts/verify-facebook-live-media.mjs';

const directories: string[] = [];

async function privateDirectory() {
  const path = await mkdtemp(join(tmpdir(), 'msp-facebook-canary-test-'));
  await import('node:fs/promises').then(fs => fs.chmod(path, 0o700));
  directories.push(path);
  return path;
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

function ledger(steps: Array<Record<string, unknown>> = [], feed: Record<string, unknown> | null = null) {
  return {
    operationId: 'operation-1', remoteTargetId: 'page-1', steps, feed,
    cleanup: { status: 'pending', note: null as string | null },
  };
}

function completeLedger() {
  const value = ledger([
    { phase: 'photo', ordinal: 1, state: 'recorded', remoteId: 'photo-1', cleanup: { state: 'confirmed' } },
    { phase: 'photo', ordinal: 2, state: 'recorded', remoteId: 'photo-2', cleanup: { state: 'confirmed' } },
  ], { state: 'recorded', remoteId: 'post-1', cleanup: { state: 'confirmed' } });
  return {
    ...value,
    feed: value.feed!,
    status: 'published',
    cleanup: { status: 'complete', note: null },
    verification: { feedPublished: true, photoAssociation: true },
  };
}

const engineWith = (overrides: Record<string, unknown> = {}) => ({
  deletePost: vi.fn(async () => undefined),
  getPhotoCleanupState: vi.fn(async (_token: string, id: string) => ({ id, can_delete: true })),
  deletePhoto: vi.fn(async () => undefined),
  ...overrides,
});

describe('Facebook live media canary file journal', () => {
  it('generates local valid PNG fixtures without fetching assets', () => {
    const first = generatePngFixture(0);
    const second = generatePngFixture(1);

    expect(first.mimeType).toBe('image/png');
    expect(first.bytes.byteLength).toBeLessThanOrEqual(8 * 1024 * 1024);
    expect(validPngSignature(first.bytes)).toBe(true);
    expect(validPngSignature(second.bytes)).toBe(true);
    expect(first.bytes.readUInt32BE(16)).toBe(640);
    expect(first.bytes.readUInt32BE(20)).toBe(480);
    expect(first.bytes.equals(second.bytes)).toBe(false);
    expect(validPngSignature(Buffer.from('not a png'))).toBe(false);
  });

  it('persists each intent and receipt before allowing the next phase', async () => {
    const directory = await privateDirectory();
    const run = ledger();
    const journal = createFileJournal(directory, run)('operation-1', 'page-1');
    const snapshot = async () => JSON.parse(await readFile(join(directory, 'run.json'), 'utf8'));

    await journal.beginPhoto(1);
    expect((await snapshot()).steps).toEqual([{ phase: 'photo', ordinal: 1, state: 'started', remoteId: null, cleanup: null }]);
    await expect(journal.beginPhoto(2)).rejects.toThrow();
    await expect(journal.beginFeed([])).rejects.toThrow();
    await journal.recordPhoto(1, 'photo-1');
    expect((await snapshot()).steps[0]).toMatchObject({ state: 'recorded', remoteId: 'photo-1' });
    await journal.beginPhoto(2);
    await journal.recordPhoto(2, 'photo-2');
    await expect(journal.beginPhoto(3)).rejects.toThrow();
    await journal.beginFeed(['photo-1', 'photo-2']);
    expect((await snapshot()).feed).toEqual({ state: 'started', remoteId: null, cleanup: null });
    await journal.recordFeed('post-1');
    expect((await snapshot()).feed).toMatchObject({ state: 'recorded', remoteId: 'post-1' });
  });

  it('keeps a started feed held and does not issue cleanup requests', async () => {
    const directory = await privateDirectory();
    const run = ledger([
      { phase: 'photo', ordinal: 1, state: 'recorded', remoteId: 'photo-1', cleanup: null },
      { phase: 'photo', ordinal: 2, state: 'recorded', remoteId: 'photo-2', cleanup: null },
    ], { state: 'started', remoteId: null, cleanup: null });
    const engine = engineWith();

    await cleanupKnownMedia(engine, 'page-token', run, directory);

    expect(run.cleanup.status).toBe('held_unknown_feed');
    expect(engine.deletePost).not.toHaveBeenCalled();
    expect(engine.getPhotoCleanupState).not.toHaveBeenCalled();
    expect(engine.deletePhoto).not.toHaveBeenCalled();
    expect(JSON.parse(await readFile(join(directory, 'run.json'), 'utf8')).cleanup.status).toBe('held_unknown_feed');
  });

  it('does not mark cleanup complete when any photo intent has an unknown outcome', async () => {
    const directory = await privateDirectory();
    const run = ledger([
      { phase: 'photo', ordinal: 1, state: 'recorded', remoteId: 'photo-1', cleanup: null },
      { phase: 'photo', ordinal: 2, state: 'started', remoteId: null, cleanup: null },
    ]);
    const engine = engineWith();

    await cleanupKnownMedia(engine, 'page-token', run, directory);

    expect(engine.deletePhoto).toHaveBeenCalledTimes(1);
    expect(engine.deletePhoto).toHaveBeenCalledWith('page-token', 'photo-1');
    expect(run.cleanup.status).toBe('held_photo_cleanup');
    expect(JSON.parse(await readFile(join(directory, 'run.json'), 'utf8')).cleanup.status).not.toBe('complete');
  });

  it('cleans only exact known photo IDs and requires successful engine receipts', async () => {
    const directory = await privateDirectory();
    const run = ledger([
      { phase: 'photo', ordinal: 1, state: 'recorded', remoteId: 'photo-exact-1', cleanup: null },
      { phase: 'photo', ordinal: 2, state: 'recorded', remoteId: 'photo-exact-2', cleanup: null },
    ], { state: 'rejected', remoteId: null, cleanup: null });
    const engine = engineWith();

    await cleanupKnownMedia(engine, 'page-token', run, directory);

    expect(engine.getPhotoCleanupState.mock.calls.map(call => call[1])).toEqual(['photo-exact-1', 'photo-exact-2']);
    expect(engine.deletePhoto.mock.calls).toEqual([['page-token', 'photo-exact-1'], ['page-token', 'photo-exact-2']]);
    expect(run.cleanup.status).toBe('complete');

    const failedDirectory = await privateDirectory();
    const failed = ledger([
      { phase: 'photo', ordinal: 1, state: 'recorded', remoteId: 'photo-exact-1', cleanup: null },
    ], { state: 'rejected', remoteId: null, cleanup: null });
    const noReceiptEngine = engineWith({ deletePhoto: vi.fn(async () => { throw new Error('unconfirmed delete response'); }) });
    await cleanupKnownMedia(noReceiptEngine, 'page-token', failed, failedDirectory);

    expect(failed.steps[0].cleanup).toMatchObject({ state: 'uncertain' });
    expect(failed.cleanup.status).toBe('held_photo_cleanup');
  });

  it('blocks a photo with a positive feed association before DELETE', async () => {
    const directory = await privateDirectory();
    const run = ledger([
      { phase: 'photo', ordinal: 1, state: 'recorded', remoteId: 'photo-1', cleanup: null },
    ]);
    const engine = engineWith({ getPhotoCleanupState: vi.fn(async () => ({ id: 'photo-1', can_delete: true, page_story_id: 'post-1' })) });

    await cleanupKnownMedia(engine, 'page-token', run, directory);

    expect(engine.getPhotoCleanupState).toHaveBeenCalledWith('page-token', 'photo-1');
    expect(engine.deletePhoto).not.toHaveBeenCalled();
    expect(run.steps[0].cleanup).toMatchObject({ state: 'blocked', reason: 'still_associated' });
    expect(run.cleanup.status).toBe('held_photo_cleanup');
    expect(safePhotoState({ id: 'photo-1', can_delete: true, page_story_id: 'post-1' }, 'photo-1')).toBe(false);
  });

  it('never repeats an uncertain photo DELETE', async () => {
    const directory = await privateDirectory();
    const run = ledger([
      { phase: 'photo', ordinal: 1, state: 'recorded', remoteId: 'photo-1', cleanup: null },
    ]);
    const engine = engineWith({ deletePhoto: vi.fn(async () => { throw new Error('response outcome unknown'); }) });

    await cleanupKnownMedia(engine, 'page-token', run, directory);
    expect(run.steps[0].cleanup).toMatchObject({ state: 'uncertain' });
    await cleanupKnownMedia(engine, 'page-token', run, directory);

    expect(engine.deletePhoto).toHaveBeenCalledTimes(1);
    expect(run.cleanup.status).toBe('held_photo_cleanup');
  });

  it('never repeats an uncertain feed DELETE or proceeds to photos', async () => {
    const directory = await privateDirectory();
    const run = ledger([
      { phase: 'photo', ordinal: 1, state: 'recorded', remoteId: 'photo-1', cleanup: null },
    ], { state: 'recorded', remoteId: 'post-1', cleanup: null });
    const engine = engineWith({ deletePost: vi.fn(async () => { throw new Error('unconfirmed feed deletion'); }) });

    await cleanupKnownMedia(engine, 'page-token', run, directory);
    await cleanupKnownMedia(engine, 'page-token', run, directory);

    expect(engine.deletePost).toHaveBeenCalledTimes(1);
    expect(engine.deletePost).toHaveBeenCalledWith('page-token', 'post-1');
    expect(engine.getPhotoCleanupState).not.toHaveBeenCalled();
    expect(engine.deletePhoto).not.toHaveBeenCalled();
    expect(run.feed?.cleanup).toMatchObject({ state: 'uncertain' });
    expect(run.cleanup.status).toBe('held_feed_delete_unknown');
  });

  it('serializes canaries per Page while allowing different Pages concurrently', async () => {
    const parent = await privateDirectory();
    const samePage = await Promise.allSettled([
      acquirePageLock(parent, 'page-same'),
      acquirePageLock(parent, 'page-same'),
    ]);
    const winners = samePage.filter(result => result.status === 'fulfilled');
    expect(winners).toHaveLength(1);
    expect(samePage.filter(result => result.status === 'rejected')).toHaveLength(1);
    if (winners[0].status !== 'fulfilled') throw new Error('Expected a Page lock owner.');
    await releasePageLock(winners[0].value);

    const differentPages = await Promise.all([
      acquirePageLock(parent, 'page-a'),
      acquirePageLock(parent, 'page-b'),
    ]);
    expect(differentPages).toHaveLength(2);
    await Promise.all(differentPages.map(releasePageLock));
    expect(await readdir(parent)).toEqual([]);
  });

  it('retains the Page lock while the ledger has unresolved outcomes', async () => {
    const parent = await privateDirectory();
    const held = await acquirePageLock(parent, 'page-held');
    const unknown = completeLedger();
    unknown.feed.cleanup = { state: 'uncertain' };
    expect(canFinalizeCompletedRun(unknown)).toBe(false);
    await expect(acquirePageLock(parent, 'page-held')).rejects.toThrow();
    await releasePageLock(held);
  });

  it('finalizes only exact, fully confirmed and read-back verified receipts', async () => {
    const parent = await privateDirectory();
    const runDirectory = await mkdtemp(join(parent, 'run-'));
    const run = completeLedger();
    await import('node:fs/promises').then(fs => fs.writeFile(join(runDirectory, 'run.json'), JSON.stringify(run)));

    await expect(finalizeCompletedRun(runDirectory, parent, run)).resolves.toBe(true);
    expect(await readdir(parent)).toEqual([]);

    const cases = [
      ['unknown delete', (value: ReturnType<typeof completeLedger>) => { value.steps[0].cleanup = { state: 'uncertain' }; }],
      ['missing photo receipt', (value: ReturnType<typeof completeLedger>) => { value.steps[1].remoteId = null; }],
      ['unverified association', (value: ReturnType<typeof completeLedger>) => { value.verification.photoAssociation = false; }],
      ['publish error', (value: ReturnType<typeof completeLedger>) => { value.status = 'publish_needs_review'; }],
    ] as const;
    for (const [name, change] of cases) {
      const heldDirectory = await mkdtemp(join(parent, `held-${name.replaceAll(' ', '-')}-`));
      const held = completeLedger();
      change(held);
      await import('node:fs/promises').then(fs => fs.writeFile(join(heldDirectory, 'run.json'), JSON.stringify(held)));
      expect(canFinalizeCompletedRun(held, name === 'publish error')).toBe(false);
      await expect(finalizeCompletedRun(heldDirectory, parent, held, name === 'publish error')).resolves.toBe(false);
      expect(await readdir(heldDirectory)).toContain('run.json');
    }
  });

  it('refuses to remove a ledger whose on-disk binding differs from the verified result', async () => {
    const parent = await privateDirectory();
    const runDirectory = await mkdtemp(join(parent, 'bound-run-'));
    const run = completeLedger();
    const stored = { ...run, remoteTargetId: 'different-page' };
    await import('node:fs/promises').then(fs => fs.writeFile(join(runDirectory, 'run.json'), JSON.stringify(stored)));

    await expect(finalizeCompletedRun(runDirectory, parent, run)).rejects.toThrow();
    expect(await readdir(runDirectory)).toContain('run.json');
  });
});
