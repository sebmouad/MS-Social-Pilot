import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { baselineSql } from './baseline-block';

it('records an ownership disposition for every table introduced since 2026-10-20', () => {
  const audit = readFileSync('src/server/data-control/README.md', 'utf8');
  // Split the baseline into its ordered source blocks; only blocks from the
  // audited era need README rows (older tables are classified in the manifest).
  const sql = baselineSql();
  const marker = /^-- ===== source \d+\/\d+: (\S+) \(sha256:[a-f0-9]{64}\) =====$/gm;
  const marks = [...sql.matchAll(marker)];
  expect(marks.length).toBeGreaterThan(0);
  const tables: string[] = [];
  marks.forEach((mark, i) => {
    if (mark[1] < '20261020000000') return;
    const start = mark.index! + mark[0].length + 1;
    const end = i + 1 < marks.length ? marks[i + 1].index! - 1 : sql.length;
    for (const m of sql.slice(start, end).matchAll(/CREATE\s+TABLE\s+(?:public\.)?"?(\w+)/gi)) tables.push(m[1]);
  });
  expect(tables.length).toBeGreaterThan(0);
  for (const table of tables) expect(audit, `Missing data-control ownership review: ${table}`).toContain(`| \`${table}\` |`);
});
