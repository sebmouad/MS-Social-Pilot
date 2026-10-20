import { expect, it } from 'vitest';
import { CONFIG_BY_KEY, safeConfigShape } from '@/lib/config/registry';
import { PERSON_KEYS_CONFIG } from '@/modules/settings/person-keys/config';
import { BEARER_SHAPE } from '@/server/mcp/bearer';
import { executeAgencyTool } from './mcp';
it('exposes validated person-key controls under the owning Settings module', () => {
 for (const entry of PERSON_KEYS_CONFIG) {
  expect(CONFIG_BY_KEY.get(entry.key)?.schema.safeParse(entry.defaultValue).success).toBe(true);
  expect(safeConfigShape().find(item => item.key === entry.key)).toMatchObject({ consumption: 'active', owner: { kind: 'product', id: 'settings' } });
 }
});
it('workspace authentication never recognizes a person secret', () => {
 expect(BEARER_SHAPE.test(`Bearer mcp_person_${'a'.repeat(43)}`)).toBe(false);
 expect(BEARER_SHAPE.test(`Bearer mcp_${'a'.repeat(43)}`)).toBe(true);
});
it('the internal Agency executor refuses credential principals that bypass person dispatch', async () => {
 for (const name of ['list_agency_clients', 'get_agency_overview']) await expect(executeAgencyTool({ scope: 'person', userId: 'u', personKeyId: 'pk', readFeature: 'agency/overview' }, name, {})).rejects.toMatchObject({ code: 'forbidden' });
});
