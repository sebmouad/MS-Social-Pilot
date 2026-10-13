import { redirect } from 'next/navigation';

import { requireRoot } from '@/lib/auth';
import { CONFIG_SECTIONS } from '@/lib/root-config-sections';

export const dynamic = 'force-dynamic';

/** The old single Configuration screen: now one screen per area, starting with the first. */
export default async function RootConfigPage() {
  await requireRoot();
  redirect(`/root/config/${CONFIG_SECTIONS[0]}`);
}
