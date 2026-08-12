import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { getAuthContext } from './auth';

/**
 * What a browser tab says.
 *
 * Every page inherited one title from the root layout, so twenty-five screens
 * all read "MS Social Pilot". That is a small thing on a product used one
 * window at a time and a real one here: this app exists to run several clients,
 * has a switcher for exactly that, and an agency with three of them open sees
 * three identical tabs.
 *
 * So the screen comes first — a tab strip crops from the right, and "Posts" is
 * what tells them apart — and the client comes after it, which is what tells
 * the three windows apart once they are down to a favicon and six characters.
 */
export async function screenMetadata(key: string): Promise<Metadata> {
  const [namespace, ...rest] = key.split('.');
  const t = await getTranslations(namespace);
  const screen = t(rest.join('.'));

  // Cached per request, so this costs nothing on top of the page's own call.
  const auth = await getAuthContext().catch(() => null);

  const app = await getTranslations('app');
  const suffix = auth?.workspace.name ?? app('name');

  return { title: `${screen} · ${suffix}` };
}
