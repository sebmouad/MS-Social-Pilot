import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

// Optional local SQL execution on Node versions with the built-in SQLite module.
// PostgreSQL rehearsal remains a separate release requirement.
let DatabaseSync: typeof import('node:sqlite').DatabaseSync | undefined;
try { ({ DatabaseSync } = createRequire(import.meta.url)('node:sqlite')); } catch { /* Node 20 */ }

const sql = readFileSync('prisma/migrations/20261022200000_root_admin_settings/migration.sql', 'utf8');

describe('saved Root administration setting rename', () => {
  it.skipIf(!DatabaseSync)('preserves values and metadata, skips collisions and is idempotent', () => {
    const database = new DatabaseSync!(':memory:');
    try {
      database.exec('CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT, encrypted INTEGER, updated_at TEXT)');
      const insert = database.prepare('INSERT INTO app_settings VALUES (?, ?, ?, ?)');
      const timestamp = '2026-10-22T00:00:00Z';
      insert.run('root.legacy.searchMaxCharacters', '321', 0, timestamp);
      insert.run('root.legacy.planCatalogLimit', '77', 1, timestamp);
      insert.run('root.admin.planCatalogLimit', '99', 0, timestamp);
      insert.run('root.legacyExtra.untouched', 'other', 0, timestamp);
      insert.run('settings.unchanged', 'value', 0, timestamp);

      database.exec(sql);
      const rows = database.prepare('SELECT * FROM app_settings ORDER BY key').all();
      expect(rows).toEqual([
        { key: 'root.admin.planCatalogLimit', value: '99', encrypted: 0, updated_at: timestamp },
        { key: 'root.admin.searchMaxCharacters', value: '321', encrypted: 0, updated_at: timestamp },
        { key: 'root.legacy.planCatalogLimit', value: '77', encrypted: 1, updated_at: timestamp },
        { key: 'root.legacyExtra.untouched', value: 'other', encrypted: 0, updated_at: timestamp },
        { key: 'settings.unchanged', value: 'value', encrypted: 0, updated_at: timestamp },
      ]);
      database.exec(sql);
      expect(database.prepare('SELECT * FROM app_settings ORDER BY key').all()).toEqual(rows);
    } finally { database.close(); }
  });
});
