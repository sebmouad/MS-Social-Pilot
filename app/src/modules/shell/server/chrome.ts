import { headers } from 'next/headers';
import { configOrDefault, configValueOrDefault } from '@/server/config/config-or-default';
import { SHELL_COPY, resolveShellCopy, shellPolicySchema, type ShellCopy, type ShellPolicy } from '../copy';

export type ShellChrome = { copy: ShellCopy; policy: ShellPolicy; locale: 'en' | 'fr' };

/** Current-locale shell copy and behaviour policy from Root (`home.shellCopy`, `home.shellPolicy`). Saved catalogs with obsolete keys (for example pre-B9 `pageTools*`) keep their remaining entries; a missing or unreadable catalog falls back to the registry default. */
export async function shellChrome(): Promise<ShellChrome> {
  const locale = (await headers()).get('accept-language')?.toLowerCase().startsWith('fr') ? 'fr' : 'en';
  const [saved, policy] = await Promise.all([
    configValueOrDefault('home.shellCopy').catch(() => SHELL_COPY),
    configOrDefault('home.shellPolicy', shellPolicySchema),
  ]);
  return { copy: resolveShellCopy(saved)[locale], policy: policy as ShellPolicy, locale };
}
