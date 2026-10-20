import { z } from 'zod';
import { entry } from '@/lib/config/entry';
export const profilePolicySchema = z.object({ maxGroups: z.number().int().min(1).max(1000), maxChannels: z.number().int().min(1).max(10000), maxLabelsPerChannel: z.number().int().min(1).max(100), maxNameCharacters: z.number().int().min(1).max(200) }).strict();
export const CHANNEL_PROFILES_CONFIG = [entry({ key: 'settings.channelProfilesPolicy', group: 'Settings · Channel profiles', label: 'Channel groups and labels limits', kind: 'json', description: 'Complete-or-refused directory bounds and limits for customer-owned channel groups and profile labels.', defaultValue: { maxGroups: 100, maxChannels: 1000, maxLabelsPerChannel: 10, maxNameCharacters: 80 }, schema: profilePolicySchema, consumption: 'active' })] as const;
