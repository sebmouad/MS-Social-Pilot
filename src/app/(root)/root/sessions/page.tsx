import { getTranslations } from 'next-intl/server';

import { SessionList } from '@/components/SessionList';
import { currentSessionTokenHash, requireRoot } from '@/lib/auth';
import { screenMetadata } from '@/lib/metadata';
import { listAllSessions } from '@/lib/sessions';

export const dynamic = 'force-dynamic';

export function generateMetadata() {
  return screenMetadata('root.sessions.title');
}

/** Every signed-in browser on the installation, whose it is, and a way to end it. */
export default async function RootSessionsPage() {
  await requireRoot();
  const t = await getTranslations('root');
  const sessions = await listAllSessions(await currentSessionTokenHash());

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">{t('sessions.title')}</h1>
        <p className="mt-1 text-sm text-slate-600">{t('sessions.subtitle', { count: sessions.length })}</p>
      </header>
      <div className="card p-4">
        <SessionList sessions={sessions} endpoint="/api/root/sessions" showUser />
      </div>
    </div>
  );
}
