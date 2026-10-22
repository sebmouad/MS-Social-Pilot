import { describe, expect, it } from 'vitest';
import { baselineBlock } from './baseline-block';

const migration = baselineBlock('20261031180000_rebuild_ads_ad_creation');
const previous = baselineBlock('20261030110000_rebuild_ads_creative_creation');

describe('additive ad.create journal migration', () => {

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
