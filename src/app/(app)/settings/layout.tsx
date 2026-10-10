import { getTranslations } from 'next-intl/server';

import { SettingsNav } from '@/components/SettingsNav';
import { requirePage } from '@/lib/auth';
import { canManageInstance, canManageTeam } from '@/lib/constants';

/**
 * Settings as Facebook lays them out: the sections in a menu down the left,
 * the one open beside it. On a phone the menu is a strip of tabs above.
 *
 * One menu for every settings screen, here rather than repeated in each page,
 * so it cannot disagree with itself about which sections someone may open.
 */
export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const auth = await requirePage();
  const t = await getTranslations('settings');

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
      <aside className="min-w-0 lg:sticky lg:top-24">
        <p className="mb-2 hidden px-2 text-2xl font-bold text-slate-900 lg:block">{t('title')}</p>
        <SettingsNav showConfig={canManageInstance(auth)} showHistory={canManageTeam(auth.role)} />
      </aside>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
