import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Prisma `$queryRaw` cannot deserialize a `void` column, so `SELECT pg_advisory_xact_lock(...)` throws on a real
 * database (it passes with mocks). Selects of void functions must cast (`::text`) or use `SELECT 1 FROM ...`,
 * or run through `$executeRaw`. Two such defects reached main before real-PostgreSQL runs caught them.
 */
function files(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? files(full) : /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

describe('raw SQL void selects', () => {
  it('casts or wraps every $queryRaw select of a void lock function', () => {
    const offenders: string[] = [];
    for (const file of files('src')) {
      const text = readFileSync(file, 'utf8');
      for (const match of text.matchAll(/\$queryRaw(?:<[^`]*>)?`\s*SELECT\s+(pg_advisory_xact_lock|pg_advisory_lock|pg_notify|pg_sleep)\(/g)) {
        // The statement can nest template strings inside ${...}, so read to the end of the line.
        const end = text.indexOf('\n', match.index!);
        const rest = text.slice(match.index!, end < 0 ? undefined : end);
        if (!/\)\s*::\s*\w+\s*`/.test(rest)) offenders.push(`${file}: ${match[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
