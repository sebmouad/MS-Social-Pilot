import { configOrDefault } from '@/server/config/config-or-default';
import { agentCopySchema } from '../config';
import type { AgentCopy } from '../copy';
/** Validate saved copy and fall back to the registered, schema-checked default. */
export async function agentCopy(locale: 'en' | 'fr'): Promise<AgentCopy> {
 const catalog = await configOrDefault('agents.copy', agentCopySchema);
 return catalog[locale] as AgentCopy;
}
