import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { compareCounts, configChecks, filePresent, guardedUrl, invalidMedia } from '../scripts/verify-legacy-migration';

const baseline = { version: 1 as const, counts: { posts: '2', targets: '1' }, rootKeys: [] };
const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });

describe('legacy migration verifier', () => {
  it.each(['postgresql://u:p@127.0.0.1/example_preview', 'postgres://u:p@localhost:55432/example_rehearsal', 'postgresql://u:p@[::1]/copy_preview'])('accepts guarded URL %s', url => expect(guardedUrl(url)).toContain('_'));
  it.each([
    'postgresql://u:secret@remote.example/copy_preview', 'postgresql://localhost/production',
    'postgresql://localhost/copy_preview?host=remote', 'postgresql://localhost/copy_preview?schema=other',
    'postgresql://localhost/copy_preview?options=-csearch_path=evil', 'file:///copy_preview',
    'postgresql://127.0.0.1.evil/copy_preview', 'postgresql://localhost/copy_preview/extra',
    'postgresql://localhost/copy_%70review', '',
  ])('refuses unsafe URL without reflecting credentials %s', url => {
    expect(() => guardedUrl(url)).toThrow();
    try { guardedUrl(url); } catch (error) { expect(String(error)).not.toContain('secret'); }
  });
  it('compares exact counts including missing tables, new nonempty tables and empty additive tables', () => {
    expect(compareCounts({ posts: '2', targets: '1', journal: '0' }, baseline).every(c => c.failures === '0')).toBe(true);
    expect(compareCounts({ posts: '1', journal: '1' }, baseline).filter(c => c.failures !== '0')).toHaveLength(3);
    expect(() => compareCounts({}, { ...baseline, counts: { posts: '-1' } })).toThrow();
    expect(() => compareCounts({}, { ...baseline, counts: { posts: 0 as unknown as string } })).toThrow();
  });
  it('rejects malformed post JSON without requiring optional metadata', () => {
    for (const value of [null, {}, [null], [{ url: 'x' }], [{ kind: 'unknown', url: 'x' }], [{ kind: 'image', url: '' }]]) expect(invalidMedia(value)).toBe(true);
    expect(invalidMedia([])).toBe(false);
    expect(invalidMedia([{ kind: 'image', url: 'media:synthetic', altText: 'Exemple' }])).toBe(false);
  });
  it('checks imported registry keys and validates nonsecret and encrypted values without reporting values', () => {
    const rows = [
      { key: 'auth.loginAttempts', value: 'private-invalid-value', encrypted: false },
      { key: 'meta.appSecret', value: 'private-secret', encrypted: false },
    ];
    const result = configChecks(rows, ['security.twoStep']);
    expect(result.filter(c => c.failures === '1')).toHaveLength(3);
    expect(JSON.stringify(result)).not.toContain('private-');
    expect(configChecks([{ key: 'auth.loginAttempts', value: 5, encrypted: false }], ['auth.loginAttempts']).every(c => c.failures === '0')).toBe(true);
  });
  it('checks disk references and refuses traversal, directories and symlinks', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'migration-fixture-')); dirs.push(root);
    await mkdir(path.join(root, 'workspace', 'images'), { recursive: true });
    await writeFile(path.join(root, 'workspace', 'images', 'id'), 'synthetic image');
    await symlink(path.join(root, 'workspace'), path.join(root, 'alias'));
    await symlink(path.join(root, 'workspace', 'images', 'id'), path.join(root, 'link'));
    expect(await filePresent(root, 'workspace/images/id')).toBe(true);
    for (const key of ['../outside', '/etc/passwd', 'workspace/images/missing', 'workspace/images', 'alias/images/id', 'link', 'workspace/../workspace/images/id']) expect(await filePresent(root, key)).toBe(false);
  });
});
