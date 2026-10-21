import { readFileSync, readdirSync } from 'node:fs';
import { expect, it } from 'vitest';

it('records an ownership disposition for every table introduced since 2026-10-20', () => {
  const audit = readFileSync('src/server/data-control/README.md', 'utf8');
  const tables = readdirSync('../prisma/migrations').filter(name => /^\d{14}_/.test(name) && name >= '20261020000000').flatMap(name => {
    const sql = readFileSync(`../prisma/migrations/${name}/migration.sql`, 'utf8');
    return [...sql.matchAll(/CREATE\s+TABLE\s+(?:public\.)?"?(\w+)/gi)].map(match => match[1]);
  });
  expect(tables.length).toBeGreaterThan(0);
  for (const table of tables) expect(audit, `Missing data-control ownership review: ${table}`).toContain(`| \`${table}\` |`);
});
