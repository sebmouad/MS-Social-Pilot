import { redirect } from 'next/navigation';

import { getAuthContext } from '@/lib/auth';
import { isFirstRun } from '@/lib/setup';
import { siteIsPublic } from '@/lib/site';
import { SiteHome } from '@/components/SiteHome';

export default async function HomePage() {
  const auth = await getAuthContext();
  if (auth) redirect('/dashboard');

  // A server nobody has used yet answered with a sign-in form for an account
  // that does not exist. Send whoever just deployed it somewhere useful.
  if (await isFirstRun()) redirect('/setup');

  // Root's switch: a product site for visitors, or straight to sign-in.
  if (await siteIsPublic()) return <SiteHome />;
  redirect('/login');
}
