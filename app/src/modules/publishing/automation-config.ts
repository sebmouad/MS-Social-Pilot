import { z } from 'zod';
import { cron, entry } from '@/lib/config/entry';

/** Root controls for the Publishing-owned automatic recycle and content-mix jobs. */
export const PUBLISHING_AUTOMATION_CONFIG = [
  entry({ key: 'publishing.automation.recycleSchedule', group: 'Publishing · Automation', label: 'Post recycling schedule', kind: 'text', description: 'Five-field cron schedule for lifecycle-checked post recycling.', defaultValue: '23 * * * *', schema: cron, consumption: 'active' }),
  entry({ key: 'publishing.automation.mixSchedule', group: 'Publishing · Automation', label: 'Content mix schedule', kind: 'text', description: 'Five-field cron schedule for lifecycle-checked content-mix scheduling.', defaultValue: '37 * * * *', schema: cron, consumption: 'active' }),
  entry({ key: 'publishing.automation.recycleCursor', group: 'Publishing · Automation', label: 'Recycling scan position', kind: 'text', description: 'Persistent last-scanned post ID for fair, bounded recycling scans. Clear this value to reset the scan position.', defaultValue: '', schema: z.string().max(80).regex(/^[A-Za-z0-9_:-]*$/), consumption: 'active' }),
  entry({ key: 'publishing.automation.mixCursor', group: 'Publishing · Automation', label: 'Content mix scan position', kind: 'text', description: 'Persistent last-scanned workspace ID for fair, bounded content-mix scans. Clear this value to reset the scan position.', defaultValue: '', schema: z.string().max(80).regex(/^[A-Za-z0-9_:-]*$/), consumption: 'active' }),
] as const;

export const PUBLISHING_AUTOMATION_KEYS = PUBLISHING_AUTOMATION_CONFIG.map(({ key }) => key);
