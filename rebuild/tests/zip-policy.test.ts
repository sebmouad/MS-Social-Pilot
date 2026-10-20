import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ZipWriter, ZIP32_MAX_BYTES } from '@/server/data-control/zip';

describe('ZIP32 configured archive bounds', () => {
  it('counts both headers, names and the central directory before accepting an entry', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'zip-policy-'));
    const filename = path.join(dir, 'one.zip');
    // Empty file `a`: local header 30 + name 1 + central header 46 + name 1 + end 22 = 100.
    const zip = new ZipWriter(filename, 100);
    try {
      await zip.add('a', Buffer.alloc(0));
      await expect(zip.add('b', Buffer.from('extra'))).rejects.toThrow(/archive size limit/);
      expect(await zip.close()).toBe(100);
      expect((await readFile(filename)).length).toBe(100);
    } finally { zip.abort(); await rm(dir, { recursive: true, force: true }); }
  });
  it('refuses an entry name that cannot fit the ZIP32 name field', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'zip-policy-'));
    const zip = new ZipWriter(path.join(dir, 'bad.zip'));
    try { await expect(zip.add('x'.repeat(65536), '')).rejects.toThrow(/archive size limit/); }
    finally { zip.abort(); await rm(dir, { recursive: true, force: true }); }
  });
  it('refuses a size policy requiring ZIP64 before opening a stream', () => {
    expect(() => new ZipWriter('/unused', ZIP32_MAX_BYTES + 1)).toThrow(/ZIP32/);
    expect(() => new ZipWriter('/unused', 0)).toThrow(/ZIP32/);
  });
});
