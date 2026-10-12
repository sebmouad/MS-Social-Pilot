import { ScreenHeader } from '@/components/ScreenHeader';
import { getTranslations } from 'next-intl/server';

import { AccountClient } from '@/components/AccountClient';
import { TwoStepSettings } from '@/components/TwoStepForms';
import { twoStepStatus } from '@/lib/two-step';
import { currentSessionTokenHash, requirePage } from '@/lib/auth';
import { readAccount } from '@/lib/account';
import { listSessions } from '@/lib/sessions';
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

  const tokenHash = await currentSessionTokenHash();
  const [account, twoStep, sessions] = await Promise.all([
    readAccount(auth.user.id, tokenHash),
    twoStepStatus(auth.user.id),
    listSessions(auth.user.id, tokenHash),
  ]);

  return (
    <div className="space-y-6">
      <ScreenHeader title={t('title')} subtitle={t('subtitle')} />

      <AccountClient initial={account} sessions={sessions} locales={SUPPORTED_LOCALES} />

      <TwoStepSettings initial={twoStep} />
    </div>
  );
}
