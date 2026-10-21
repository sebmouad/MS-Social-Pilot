import { loadInboxCustomerCopy } from './customer-copy';
import type { inboxServiceCopy } from '../service-copy';
/** Shared service errors use the same Root catalog across UI, REST and MCP. Wire language defaults to English. */
export async function inboxServiceText(key: keyof typeof inboxServiceCopy, values: Record<string, string | number> = {}, locale: 'en' | 'fr' = 'en'): Promise<string> {
  return (await loadInboxCustomerCopy())[`errors.${key}`][locale].replace(/\{(\w+)\}/g, (whole, name: string) => name in values ? String(values[name]) : whole);
}
