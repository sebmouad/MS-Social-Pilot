import { getTranslations } from 'next-intl/server';

import { NotificationsClient } from '@/components/NotificationsClient';
import { SettingsNav } from '@/components/SettingsNav';
import { requirePage } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { emailEnabled } from '@/lib/email/send';

export const dynamic = 'force-dynamic';

export default async function NotificationsSettingsPage() {
  const auth = await requirePage();
  const t = await getTranslations('notifications');

  const setting = await prisma.notificationSetting.findUnique({
    where: { userId_workspaceId: { userId: auth.user.id, workspaceId: auth.workspace.id } },
  });

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-slate-900">{t('title')}</h1>
        <p className="mt-1 text-sm text-slate-600">{t('subtitle')}</p>
      </header>

      <SettingsNav />

      <NotificationsClient
        emailConfigured={emailEnabled()}
        // No row yet means not configured, which is treated as opted in.
        initial={{
          onPublishFailure: setting?.onPublishFailure ?? true,
          onTokenExpiry: setting?.onTokenExpiry ?? true,
          onApprovalRequest: setting?.onApprovalRequest ?? true,
          onApprovalDecision: setting?.onApprovalDecision ?? true,
        }}
      />
    </div>
  );
}
