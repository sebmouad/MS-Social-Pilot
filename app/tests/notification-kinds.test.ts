// Every notification kind the app sends must be storable (2026-11-16): the database's kind check had fallen behind the
// code, so new kinds were silently refused. The latest migration that sets the check must list exactly the app's kinds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NOTIFICATION_EVENTS } from '@/modules/settings/notifications/contracts';

test('notifications: the database accepts every kind the app sends', () => {
  const dir = join(process.cwd(), 'prisma', 'migrations');
  const latest = readdirSync(dir).filter(name => /^\d{4}_/.test(name)).sort().reverse()
    .map(name => readFileSync(join(dir, name, 'migration.sql'), 'utf8'))
    .flatMap(sql => [...sql.matchAll(/ADD CONSTRAINT notifications_kind_check CHECK \(kind IN \(([\s\S]*?)\)\)/g)].map(match => match[1]!).reverse())[0];
  assert.ok(latest, 'a migration sets notifications_kind_check');
  const kinds = [...latest!.matchAll(/'([a-z_]+)'/g)].map(match => match[1]).sort();
  assert.deepEqual(kinds, [...NOTIFICATION_EVENTS].sort());
});
