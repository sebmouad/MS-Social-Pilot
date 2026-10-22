import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync('prisma/migrations/20261031180000_rebuild_ads_ad_creation/migration.sql', 'utf8');
const previous = readFileSync('prisma/migrations/20261030110000_rebuild_ads_creative_creation/migration.sql', 'utf8');

describe('additive ad.create journal migration', () => {
  it('pins the reviewed SQL checksum', () => {
    expect(createHash('sha256').update(migration).digest('hex')).toBe('1769fa24129e6d74119e84d0677a2baf0c935cb73a4e722ae0a443b7fbc7120f');
  });

  it('extends only the operation-kind CHECK and preserves all existing operations', () => {
    const kinds = (sql: string) => [...sql.matchAll(/"operationType" IN \(([^)]+)\)/g)][0]![1]!.match(/'[^']+'/g)!;
    expect(kinds(migration)).toEqual([...kinds(previous), "'ad.create'"]);
    const sql = migration.replace(/--[^\n]*/g, '').trim();
    expect(sql.split(';').filter(part => part.trim())).toHaveLength(2);
    expect(sql).toContain('DROP CONSTRAINT ads_operations_operation_kind');
    expect(sql).toContain('ADD CONSTRAINT ads_operations_operation_kind CHECK');
    expect(sql).not.toMatch(/DROP (TABLE|INDEX)|DELETE FROM|UPDATE \w+ SET|INSERT INTO|TRUNCATE|NOT VALID/i);
  });
});
