import type { Mapping } from './recipe';

/**
 * Read-only access to the WordPress database. Only SELECT statements are ever issued; the account is expected to
 * be SELECT-only on the posts and post-meta tables. The driver is loaded on first use and can be injected.
 */
export type DbSettings = { url: string; tablePrefix: string; connectTimeoutMs: number; queryTimeoutMs: number; poolSize: number };
export type WpCandidateRow = { id: string; title: string; slug: string; publishedAt: Date | null; caption: string; imageId: string; recipe: string };
export type CandidateQuery = { mapping: Mapping; order: 'newest' | 'oldest'; skipShared: boolean; maxAgeDays: number; afterId: string | null; limit: number; now: Date };
export type WpDb = {
  candidates(query: CandidateQuery): Promise<WpCandidateRow[]>;
  /** attachment ID -> relative file path under the uploads folder */
  attachments(ids: readonly string[], attachedFileMetaKey: string): Promise<Map<string, string>>;
  ping(): Promise<void>;
  close(): Promise<void>;
};
export type PoolLike = { query(options: { sql: string; values?: unknown[]; timeout?: number }): Promise<[unknown, unknown]>; end(): Promise<void> };
export type PoolFactory = (settings: DbSettings) => Promise<PoolLike>;

const PREFIX = /^[A-Za-z0-9_]{0,32}$/;
const DRIVER = 'mysql2/promise';

/** Connection details are parsed from the saved address; nothing is logged or echoed. */
export const defaultPoolFactory: PoolFactory = async settings => {
  const address = new URL(settings.url);
  if (address.protocol !== 'mysql:') throw new Error('unsupported_database_address');
  const driver = await import(/* webpackIgnore: true */ DRIVER) as { createPool(options: Record<string, unknown>): PoolLike };
  return driver.createPool({
    host: address.hostname, port: address.port ? Number(address.port) : 3306, user: decodeURIComponent(address.username), password: decodeURIComponent(address.password),
    database: decodeURIComponent(address.pathname.replace(/^\//, '')), connectionLimit: settings.poolSize, connectTimeout: settings.connectTimeoutMs,
    waitForConnections: true, queueLimit: 0, charset: 'utf8mb4', timezone: 'Z', supportBigNumbers: true, bigNumberStrings: true, multipleStatements: false,
    ...(address.searchParams.get('ssl') === 'true' ? { ssl: {} } : {}),
  });
};

const text = (value: unknown): string => typeof value === 'string' ? value : Buffer.isBuffer(value) ? value.toString('utf8') : value === null || value === undefined ? '' : String(value);
const asDate = (value: unknown): Date | null => {
  const date = value instanceof Date ? value : typeof value === 'string' ? new Date(`${value.replace(' ', 'T')}Z`) : null;
  return date && Number.isFinite(date.getTime()) && date.getUTCFullYear() > 1971 ? date : null;
};
const rowsOf = (result: [unknown, unknown]): Array<Record<string, unknown>> => Array.isArray(result[0]) ? result[0] as Array<Record<string, unknown>> : [];

export async function openWordpressDb(settings: DbSettings, factory: PoolFactory = defaultPoolFactory): Promise<WpDb> {
  if (!PREFIX.test(settings.tablePrefix)) throw new Error('invalid_table_prefix');
  const pool = await factory(settings);
  const posts = `\`${settings.tablePrefix}posts\``;
  const meta = `\`${settings.tablePrefix}postmeta\``;
  const run = (sql: string, values: unknown[] = []) => pool.query({ sql, values, timeout: settings.queryTimeoutMs });
  return {
    async candidates(q) {
      const where: string[] = ['p.post_type = ?', 'p.post_status = ?', "cap.meta_value <> ''", "img.meta_value <> ''", "rec.meta_value <> ''"];
      const values: unknown[] = [q.mapping.captionMetaKey, q.mapping.imageMetaKey, q.mapping.recipeMetaKey, q.mapping.postType, q.mapping.postStatus];
      if (q.afterId !== null) { where.push(q.order === 'newest' ? 'p.ID < ?' : 'p.ID > ?'); values.push(q.afterId); }
      if (q.maxAgeDays > 0) { where.push('p.post_date_gmt >= ?'); values.push(new Date(q.now.getTime() - q.maxAgeDays * 86_400_000)); }
      if (q.skipShared && q.mapping.skipMetaKey) { where.push(`NOT EXISTS (SELECT 1 FROM ${meta} s WHERE s.post_id = p.ID AND s.meta_key = ? AND s.meta_value <> '')`); values.push(q.mapping.skipMetaKey); }
      values.push(q.limit);
      const sql = `SELECT p.ID AS id, p.post_title AS title, p.post_name AS slug, p.post_date_gmt AS publishedAt, MAX(cap.meta_value) AS caption, MAX(img.meta_value) AS imageId, MAX(rec.meta_value) AS recipe
        FROM ${posts} p
        JOIN ${meta} cap ON cap.post_id = p.ID AND cap.meta_key = ?
        JOIN ${meta} img ON img.post_id = p.ID AND img.meta_key = ?
        JOIN ${meta} rec ON rec.post_id = p.ID AND rec.meta_key = ?
        WHERE ${where.join(' AND ')}
        GROUP BY p.ID, p.post_title, p.post_name, p.post_date_gmt
        ORDER BY p.ID ${q.order === 'newest' ? 'DESC' : 'ASC'} LIMIT ?`;
      return rowsOf(await run(sql, values)).map(r => ({ id: text(r['id']), title: text(r['title']), slug: text(r['slug']), publishedAt: asDate(r['publishedAt']), caption: text(r['caption']).trim(), imageId: text(r['imageId']).trim(), recipe: text(r['recipe']) }));
    },
    async attachments(ids, attachedFileMetaKey) {
      const unique = [...new Set(ids.filter(id => /^\d{1,20}$/.test(id)))];
      if (!unique.length) return new Map();
      const rows = rowsOf(await run(`SELECT post_id AS id, MAX(meta_value) AS path FROM ${meta} WHERE meta_key = ? AND post_id IN (?) GROUP BY post_id`, [attachedFileMetaKey, unique]));
      return new Map(rows.map(r => [text(r['id']), text(r['path']).trim()] as const).filter(([, path]) => path));
    },
    async ping() { await run('SELECT 1 AS ok'); },
    async close() { await pool.end().catch(() => undefined); },
  };
}
