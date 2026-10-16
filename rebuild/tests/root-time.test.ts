import { describe, expect, it } from 'vitest';
import { formatRootTimestamp } from '../src/lib/root-time';
import { CONFIG_BY_KEY } from '../src/lib/config/registry';
describe('Root operational timestamp presentation', () => {
  it('uses explicit Root timezone rather than server or browser defaults', () => {
    const at = '2026-10-16T16:00:00.000Z';
    expect(formatRootTimestamp(at, 'UTC')).toBe('16 Oct 2026, 16:00:00 (UTC)');
    expect(formatRootTimestamp(at, 'Africa/Casablanca')).toBe('16 Oct 2026, 17:00:00 (Africa/Casablanca)');
  });
  it('validates display timezone at registry boundary', () => {
    const definition = CONFIG_BY_KEY.get('root.operationalTimezone')!;
    expect(definition.schema.safeParse('Africa/Casablanca').success).toBe(true);
    expect(definition.schema.safeParse('Invalid/Timezone').success).toBe(false);
  });
});
