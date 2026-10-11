import { getTranslations } from 'next-intl/server';

import { UsersTable } from '@/components/RootClient';
import { requireRoot } from '@/lib/auth';
import { screenMetadata } from '@/lib/metadata';
import { listUsers } from '@/lib/root';

export const dynamic = 'force-dynamic';

export function generateMetadata() {
  return screenMetadata('root.users.title');
}

export default async function RootUsersPage() {
  await requireRoot();
  const t = await getTranslations('root');
  const users = await listUsers();

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">{t('users.title')}</h1>
        <p className="mt-1 text-sm text-slate-600">{t('users.subtitle', { count: users.length })}</p>
      </header>
      <UsersTable users={users} />
    </div>
  );
}
