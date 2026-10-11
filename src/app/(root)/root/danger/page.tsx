import { getTranslations } from 'next-intl/server';

import { TransferRoot } from '@/components/RootClient';
import { requireRoot } from '@/lib/auth';
import { screenMetadata } from '@/lib/metadata';
import { listUsers } from '@/lib/root';

export const dynamic = 'force-dynamic';

export function generateMetadata() {
  return screenMetadata('root.danger.title');
}

export default async function RootDangerPage() {
  const auth = await requireRoot();
  const t = await getTranslations('root');
  const users = (await listUsers()).filter((user) => user.id !== auth.user.id && !user.disabled);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">{t('danger.title')}</h1>
      </header>
      <section className="card border-red-200 p-4 sm:p-5">
        <h2 className="text-sm font-semibold text-slate-900">{t('danger.transferTitle')}</h2>
        <p className="mb-4 mt-1 text-sm text-slate-600">{t('danger.transferHint')}</p>
        <TransferRoot users={users.map((user) => ({ id: user.id, label: `${user.name} (${user.email})` }))} />
      </section>
    </div>
  );
}
