import { getTranslations } from 'next-intl/server';

import { Icon } from '@/components/Icon';
import { PrivilegesView } from '@/components/PrivilegesView';
import { requireRoot } from '@/lib/auth';
import { screenMetadata } from '@/lib/metadata';
import { privilegesByMember } from '@/lib/root';

export const dynamic = 'force-dynamic';

export function generateMetadata() {
  return screenMetadata('root.privileges.title');
}

export default async function RootPrivilegesPage() {
  await requireRoot();
  const t = await getTranslations('root.privileges');
  const members = await privilegesByMember();

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">{t('title')}</h1>
          <p className="mt-1 text-sm text-slate-600">{t('subtitle')}</p>
        </div>
        <a href="/api/root/privileges" className="btn-secondary" download>
          <Icon name="download" size={14} /> {t('export')}
        </a>
      </header>
      <PrivilegesView members={members} showWorkspace />
    </div>
  );
}
