import { z } from 'zod';
import { entry } from '@/lib/config/entry';

export const SETTINGS_WORKSPACE_CONFIG = [
  entry({ key: 'settings.workspacePolicyTimezoneMaxCharacters', group: 'Settings · Workspace policies', label: 'Workspace time zone identifier limit', kind: 'number', description: 'Maximum length accepted for an IANA time zone identifier in workspace settings.', defaultValue: 80, schema: z.number().int().min(16).max(128), consumption: 'active' }),
] as const;
