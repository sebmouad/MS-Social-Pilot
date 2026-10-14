import { describe, expect, it } from 'vitest';
import { CONFIG_BY_KEY, CONFIG_REGISTRY, safeConfigShape } from '../src/lib/config/registry';

describe('configuration registry', () => {
  it('has unique keys and public metadata never contains secret values', () => {
    const keys = CONFIG_REGISTRY.map((item) => item.key);
    expect(new Set(keys).size).toBe(keys.length);
    const secret = CONFIG_REGISTRY.find((item) => item.kind === 'secret');
    expect(secret).toBeDefined();
    expect(Object.keys(safeConfigShape().find((item) => item.key === secret!.key)!)).not.toContain('value');
  });

  it('enforces each declared value schema at its boundary', () => {
    expect(CONFIG_BY_KEY.get('meta.graphVersion')!.schema.safeParse('v25.0').success).toBe(true);
    expect(CONFIG_BY_KEY.get('meta.graphVersion')!.schema.safeParse('25.0').success).toBe(false);
    expect(CONFIG_BY_KEY.get('meta.appSecret')!.schema.safeParse('x'.repeat(2048)).success).toBe(true);
    expect(CONFIG_BY_KEY.get('meta.appSecret')!.schema.safeParse('x'.repeat(2049)).success).toBe(false);
    expect(CONFIG_BY_KEY.get('jobs.enabled')!.schema.safeParse(true).success).toBe(true);
    expect(CONFIG_BY_KEY.get('jobs.enabled')!.schema.safeParse('true').success).toBe(false);
    expect(CONFIG_BY_KEY.get('operations.supportEmail')!.schema.safeParse('').success).toBe(true);
    expect(CONFIG_BY_KEY.get('operations.supportEmail')!.schema.safeParse('ops@example.test').success).toBe(true);
    expect(CONFIG_BY_KEY.get('operations.supportEmail')!.schema.safeParse('not-an-email').success).toBe(false);
  });
});
