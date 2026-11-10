import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE } from '@/server/auth';
import { LandingPage } from '@/modules/history/ui/public-pages';
import { loadOperator } from '@/modules/history/server/site';

export const dynamic = 'force-dynamic';
export async function generateMetadata(): Promise<Metadata> {
  const { operator } = await loadOperator();
  return { title: { absolute: operator.productName } };
}

/** Signed-in people go straight to their workspace (which checks the session); everyone else sees the public front page. */
export default async function Index() {
  if ((await cookies()).get(SESSION_COOKIE)?.value) redirect('/home');
  return <LandingPage />;
}
