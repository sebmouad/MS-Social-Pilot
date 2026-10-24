import { configOrDefault } from '@/server/config/config-or-default';
import { toolsCopySchema } from '../../config';
import type { ToolsCopy } from '../copy';

export type Locale = 'en' | 'fr';
/** Language of a request: French when the browser prefers it, English otherwise. */
export const localeOf = (request: Request): Locale => request.headers.get('accept-language')?.toLowerCase().startsWith('fr') ? 'fr' : 'en';

/** Validated saved copy, falling back to the registered default. */
export async function toolsCopy(locale: Locale): Promise<ToolsCopy> {
  const catalog = await configOrDefault('ai.toolsCopy', toolsCopySchema);
  return catalog[locale] as ToolsCopy;
}
