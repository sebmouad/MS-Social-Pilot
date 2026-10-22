import { readFileSync } from 'node:fs';

/** SHA-256 of prisma/migrations/20261103000000_baseline/migration.sql. */
export const BASELINE_SHA256 = '8abd5224f753f0cb845f9bd748e12e8db3cb7dbb4f1348c714e1d62231e0f8dd';
export const BASELINE_NAME = '20261103000000_baseline';

let cached: string | null = null;
export function baselineSql(): string {
  cached ??= readFileSync(`prisma/migrations/${BASELINE_NAME}/migration.sql`, 'utf8');
  return cached;
}

/** Verbatim bytes of one squashed source migration inside the baseline. */
export function baselineBlock(name: string): string {
  const sql = baselineSql();
  const marker = new RegExp(`^-- ===== source \\d+/\\d+: ${name} \\(sha256:[a-f0-9]{64}\\) =====$`, 'm');
  const at = sql.match(marker);
  if (!at || at.index === undefined) throw new Error(`baseline source missing: ${name}`);
  const start = at.index + at[0].length + 1;
  const next = sql.indexOf('-- ===== source ', start);
  return sql.slice(start, next === -1 ? sql.length : next - 1);
}
