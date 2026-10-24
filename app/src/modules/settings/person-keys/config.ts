import { z } from 'zod';
import { entry } from '@/lib/config/entry';
export const PERSON_KEYS_CONFIG = [
  entry({ key: 'mcp.personKeys.enabled', group: 'Settings · Person MCP keys', label: 'Person Agency MCP credentials', kind: 'boolean', description: 'Allow issuance and authentication of read-only person Agency overview keys. Revocation remains available when disabled.', defaultValue: true, schema: z.boolean(), consumption: 'active' }),
  entry({ key: 'mcp.personKeys.maxActivePerPerson', group: 'Settings · Person MCP keys', label: 'Active keys per person', kind: 'number', description: 'Maximum unexpired, unrevoked person credentials. Also bounds the active key directory.', defaultValue: 10, schema: z.number().int().min(1).max(1000), consumption: 'active' }),
  entry({ key: 'mcp.personKeys.maxLifetimeDays', group: 'Settings · Person MCP keys', label: 'Person key maximum lifetime (days)', kind: 'number', description: 'Maximum lifetime selectable for person Agency overview keys.', defaultValue: 90, schema: z.number().int().min(1).max(3650), consumption: 'active' }),
  entry({ key: 'mcp.personKeys.nameMaxLength', group: 'Settings · Person MCP keys', label: 'Person key name length', kind: 'number', description: 'Maximum name length accepted by account settings and the person-key service.', defaultValue: 100, schema: z.number().int().min(1).max(200), consumption: 'active' }),
] as const;
