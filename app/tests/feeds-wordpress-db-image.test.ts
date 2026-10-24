import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import { openWordpressDb, type DbSettings, type PoolLike } from '../src/modules/feeds/wordpress/db';
import { convertToJpeg, prepareRecipeImage, RecipeImageError, type ImagePorts, type ImageSettings } from '../src/modules/feeds/wordpress/image';

const settings: DbSettings = { url: 'mysql://reader:secret@127.0.0.1:3306/newsgeet', tablePrefix: 'wp_', connectTimeoutMs: 5000, queryTimeoutMs: 9000, poolSize: 2 };
const mapping = { captionMetaKey: '_msrwa_facebook_caption', imageMetaKey: '_msrwa_facebook_generated', recipeMetaKey: '_msrwa_recipe', skipMetaKey: 'fb_shared_at', attachedFileMetaKey: '_wp_attached_file', postType: 'post', postStatus: 'publish' };
const NOW = new Date('2026-10-21T10:00:00Z');

function pool(rowsFor: (sql: string) => unknown[]) {
  const query = vi.fn(async (options: { sql: string; values?: unknown[]; timeout?: number }) => [rowsFor(options.sql), []] as [unknown, unknown]);
  const end = vi.fn(async () => undefined);
  return { query, end, factory: vi.fn(async () => ({ query, end } as PoolLike)) };
}

describe('read-only WordPress database access', () => {
  it('selects candidates with parameterised meta keys, the prefix, skip-shared, age and keyset paging', async () => {
    const p = pool(() => [{ id: '60938', title: 'Potée', slug: 'potee', publishedAt: new Date('2026-10-01T08:00:00Z'), caption: ' Légende ', imageId: '777', recipe: '{"title":"x"}' }]);
    const db = await openWordpressDb(settings, p.factory);
    const rows = await db.candidates({ mapping, order: 'newest', skipShared: true, maxAgeDays: 30, afterId: '61000', limit: 200, now: NOW });
    expect(rows).toEqual([{ id: '60938', title: 'Potée', slug: 'potee', publishedAt: new Date('2026-10-01T08:00:00Z'), caption: 'Légende', imageId: '777', recipe: '{"title":"x"}' }]);
    const call = p.query.mock.calls[0]![0];
    expect(call.sql).toMatch(/^\s*SELECT /);
    expect(call.sql).toContain('FROM `wp_posts` p');
    expect(call.sql).toContain('JOIN `wp_postmeta` cap');
    expect(call.sql).toContain('p.ID < ?');
    expect(call.sql).toContain('NOT EXISTS (SELECT 1 FROM `wp_postmeta` s');
    expect(call.sql).toContain('ORDER BY p.post_date_gmt DESC, p.ID DESC LIMIT ?');
    expect(call.sql).not.toMatch(/INSERT|UPDATE|DELETE|REPLACE|DROP|ALTER/i);
    expect(call.sql).not.toContain('_msrwa');
    expect(call.values).toEqual(['_msrwa_facebook_caption', '_msrwa_facebook_generated', '_msrwa_recipe', 'post', 'publish', '61000', new Date(NOW.getTime() - 30 * 86_400_000), 'fb_shared_at', 200]);
    expect(call.timeout).toBe(9000);
  });

  it('pages by publish date then ID, in the direction of the scan', async () => {
    const p = pool(() => []);
    const db = await openWordpressDb(settings, p.factory);
    const at = new Date('2026-09-30T10:00:00Z');
    await db.candidates({ mapping, order: 'newest', skipShared: false, maxAgeDays: 0, afterId: '70', afterDate: at, limit: 10, now: NOW });
    await db.candidates({ mapping, order: 'oldest', skipShared: false, maxAgeDays: 0, afterId: '70', afterDate: at, limit: 10, now: NOW });
    await db.candidates({ mapping, order: 'oldest', skipShared: false, maxAgeDays: 0, afterId: '70', afterDate: null, limit: 10, now: NOW });
    const [newest, oldest, undated] = p.query.mock.calls.map(c => c[0]);
    expect(newest.sql).toContain('(p.post_date_gmt < ? OR (p.post_date_gmt = ? AND p.ID < ?))');
    expect(newest.values).toEqual(expect.arrayContaining([at, '70']));
    expect(newest.sql).toContain('ORDER BY p.post_date_gmt DESC, p.ID DESC');
    expect(oldest.sql).toContain('(p.post_date_gmt > ? OR (p.post_date_gmt = ? AND p.ID > ?))');
    expect(undated.sql).toContain("p.post_date_gmt >= '1971-01-01'");
  });

  it('can include shared recipes, read oldest first and omit age and cursor', async () => {
    const p = pool(() => []);
    const db = await openWordpressDb({ ...settings, tablePrefix: '' }, p.factory);
    await db.candidates({ mapping, order: 'oldest', skipShared: false, maxAgeDays: 0, afterId: '5', limit: 10, now: NOW });
    const call = p.query.mock.calls[0]![0];
    expect(call.sql).toContain('FROM `posts` p');
    expect(call.sql).toContain('p.ID > ?');
    expect(call.sql).toContain('ORDER BY p.post_date_gmt ASC, p.ID ASC');
    expect(call.sql).not.toContain('NOT EXISTS');
    expect(call.sql).not.toContain('post_date_gmt >= ?');
  });

  it('maps attachment IDs to files, ignores non-numeric IDs and skips the query when empty', async () => {
    const p = pool(() => [{ id: 777, path: '2026/10/a-fb-1.webp' }, { id: '778', path: '  ' }]);
    const db = await openWordpressDb(settings, p.factory);
    expect(await db.attachments([], '_wp_attached_file')).toEqual(new Map());
    expect(p.query).not.toHaveBeenCalled();
    const files = await db.attachments(['777', '778', 'x; DROP TABLE', '777'], '_wp_attached_file');
    expect(files).toEqual(new Map([['777', '2026/10/a-fb-1.webp']]));
    expect(p.query.mock.calls[0]![0].values).toEqual(['_wp_attached_file', ['777', '778']]);
  });

  it('refuses unsafe prefixes, pings, and closes the pool', async () => {
    const p = pool(() => [{ ok: 1 }]);
    await expect(openWordpressDb({ ...settings, tablePrefix: 'wp_`; DROP' }, p.factory)).rejects.toThrow('invalid_table_prefix');
    expect(p.factory).not.toHaveBeenCalled();
    const db = await openWordpressDb(settings, p.factory);
    await db.ping();
    await db.close();
    expect(p.end).toHaveBeenCalledTimes(1);
  });
});

const imageSettings: ImageSettings = {
  fetch: { timeoutMs: 1000, maxBytes: 5_000_000, maxRedirects: 2, allowHttp: false, hostAllowlist: [] },
  maxPixels: 10_000_000, quality: 88, minQuality: 50, qualityStep: 20, maxOutputBytes: 5_000_000,
};
const noise = (size: number) => { const raw = Buffer.alloc(size * size * 3); for (let i = 0; i < raw.length; i += 1) raw[i] = (i * 2654435761) >>> 24; return raw; };

describe('Facebook image conversion', () => {
  it('converts WebP (with transparency) to a JPEG with the JPEG signature', async () => {
    const webp = await sharp({ create: { width: 64, height: 48, channels: 4, background: { r: 0, g: 128, b: 0, alpha: 0.5 } } }).webp().toBuffer();
    expect(webp.subarray(8, 12).toString('ascii')).toBe('WEBP');
    const jpeg = await convertToJpeg(webp, imageSettings);
    expect([jpeg[0], jpeg[1], jpeg[2]]).toEqual([0xff, 0xd8, 0xff]);
    const meta = await sharp(jpeg).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(['jpeg', 64, 48]);
  });

  it('lowers quality until the file fits and refuses a file that never fits', async () => {
    const png = await sharp(noise(200), { raw: { width: 200, height: 200, channels: 3 } }).png().toBuffer();
    const high = await convertToJpeg(png, { ...imageSettings, quality: 95, minQuality: 95, maxOutputBytes: 5_000_000 });
    const target = Math.floor(high.length * 0.7);
    const reduced = await convertToJpeg(png, { ...imageSettings, quality: 95, minQuality: 20, qualityStep: 25, maxOutputBytes: target });
    expect(reduced.length).toBeLessThanOrEqual(target);
    await expect(convertToJpeg(png, { ...imageSettings, quality: 95, minQuality: 95, maxOutputBytes: 100 })).rejects.toMatchObject({ code: 'image_too_large' });
  });

  it('runs download, inspection, conversion and storage in order with the stored file name', async () => {
    const calls: string[] = [];
    const ports: ImagePorts = {
      download: vi.fn(async (url: string) => { calls.push(`download:${url}`); return Buffer.from('webp'); }),
      inspect: vi.fn(async () => { calls.push('inspect'); }),
      convert: vi.fn(async () => { calls.push('convert'); return Buffer.from('jpeg'); }),
      store: vi.fn(async (_actor, _bytes, name: string) => { calls.push(`store:${name}`); return { id: 'media-1' }; }),
    };
    const result = await prepareRecipeImage(ports, { actor: { userId: 'u', workspaceId: 'w' }, url: 'https://recettes.newsgeet.com/wp-content/uploads/a.webp', fileName: 'a-fb.jpg', settings: imageSettings });
    expect(result).toEqual({ mediaId: 'media-1', bytes: 4 });
    expect(calls).toEqual(['download:https://recettes.newsgeet.com/wp-content/uploads/a.webp', 'inspect', 'convert', 'store:a-fb.jpg']);
    expect(ports.convert).toHaveBeenCalledWith(Buffer.from('webp'), imageSettings);
  });

  it('maps each failing step to a safe code', async () => {
    const base: ImagePorts = { download: async () => Buffer.from('x'), inspect: async () => undefined, convert: async () => Buffer.from('y'), store: async () => ({ id: 'm' }) };
    const input = { actor: { userId: 'u', workspaceId: 'w' }, url: 'https://x.test/a.webp', fileName: 'a.jpg', settings: imageSettings };
    await expect(prepareRecipeImage({ ...base, download: async () => { throw new Error('connect ECONNREFUSED 10.0.0.1'); } }, input)).rejects.toMatchObject({ code: 'image_unavailable', message: 'image_unavailable' });
    await expect(prepareRecipeImage({ ...base, inspect: async () => { throw new Error('boom /srv/tmp'); } }, input)).rejects.toMatchObject({ code: 'image_invalid' });
    await expect(prepareRecipeImage({ ...base, convert: async () => { throw new RecipeImageError('image_too_large'); } }, input)).rejects.toMatchObject({ code: 'image_too_large' });
    await expect(prepareRecipeImage({ ...base, convert: async () => { throw new Error('vips'); } }, input)).rejects.toMatchObject({ code: 'image_invalid' });
    await expect(prepareRecipeImage({ ...base, store: async () => { throw new Error('EACCES /media'); } }, input)).rejects.toMatchObject({ code: 'image_invalid' });
  });
});
