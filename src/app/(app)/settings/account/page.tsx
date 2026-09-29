import { canManageInstance } from '@/lib/constants';
import { getTranslations } from 'next-intl/server';

import { AccountClient } from '@/components/AccountClient';
import { SettingsNav } from '@/components/SettingsNav';
import { currentSessionTokenHash, requirePage } from '@/lib/auth';
import { readAccount } from '@/lib/account';
import { screenMetadata } from '@/lib/metadata';
import { SUPPORTED_LOCALES } from '@/i18n/locale';

export const dynamic = 'force-dynamic';

/** The tab says which screen and which client, so several open at once stay apart. */
export function generateMetadata() {
  return screenMetadata('account.title');
}

export default async function AccountSettingsPage() {
  const auth = await requirePage();
  const t = await getTranslations('account');

  const account = await readAccount(auth.user.id, await currentSessionTokenHash());

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-slate-900">{t('title')}</h1>
        <p className="mt-1 text-sm text-slate-600">{t('subtitle')}</p>
      </header>

      <SettingsNav showConfig={canManageInstance(auth)} />

      <AccountClient initial={account} locales={SUPPORTED_LOCALES} />
    </div>
  );
}
