import { headers } from 'next/headers';
import { configOrDefault } from '@/server/config/config-or-default';
import { shellCopySchema, shellPolicySchema, type ShellCopy, type ShellPolicy } from '../copy';

export type ShellChrome = { copy: ShellCopy; policy: ShellPolicy; locale: 'en' | 'fr' };

/** Current-locale shell copy and behaviour policy from Root (`home.shellCopy`, `home.shellPolicy`). Falls back to the registry defaults when the stored value is unusable. */
export async function shellChrome(): Promise<ShellChrome> {
  const locale = (await headers()).get('accept-language')?.toLowerCase().startsWith('fr') ? 'fr' : 'en';
  const [catalog, policy] = await Promise.all([
    configOrDefault('home.shellCopy', shellCopySchema),
    configOrDefault('home.shellPolicy', shellPolicySchema),
  ]);
  return { copy: catalog[locale] as unknown as ShellCopy, policy: policy as ShellPolicy, locale };
}
