import { getTranslations } from 'next-intl/server';

import { ChatChannelsClient } from '@/components/ChatChannelsClient';
import { NotificationsClient } from '@/components/NotificationsClient';
import { canManageSettings } from '@/lib/constants';
import { formatInZone } from '@/lib/time';
import { requirePage } from '@/lib/auth';
import { screenMetadata } from '@/lib/metadata';
import { targetScope } from '@/lib/page-access';
import { prisma } from '@/lib/prisma';
import { emailEnabled } from '@/lib/email/send';

export const dynamic = 'force-dynamic';

/** The tab says which screen and which client, so several open at once stay apart. */
export function generateMetadata() {
  return screenMetadata('notifications.title');
}


export default async function NotificationsSettingsPage() {
  const auth = await requirePage();
  const t = await getTranslations('notifications');

  const admin = canManageSettings(auth.role);
  const [setting, pages, mutes, channels] = await Promise.all([
    prisma.notificationSetting.findUnique({
      where: { userId_workspaceId: { userId: auth.user.id, workspaceId: auth.workspace.id } },
    }),
    prisma.target.findMany({
      where: { workspaceId: auth.workspace.id, ...targetScope(auth.pageScope) },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
    prisma.notificationMute.findMany({
      where: { userId: auth.user.id, target: { workspaceId: auth.workspace.id } },
      select: { targetId: true, event: true },
    }),
    admin ? prisma.chatChannel.findMany({ where: { workspaceId: auth.workspace.id }, orderBy: { createdAt: 'asc' } }) : Promise.resolve([]),
  ]);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-slate-900">{t('title')}</h1>
        <p className="mt-1 text-sm text-slate-600">{t('subtitle')}</p>
      </header>

      <NotificationsClient
        emailConfigured={emailEnabled()}
        // No row yet means not configured, which is treated as opted in.
        initial={{
          onPublishFailure: setting?.onPublishFailure ?? true,
          onTokenExpiry: setting?.onTokenExpiry ?? true,
          onApprovalRequest: setting?.onApprovalRequest ?? true,
          onApprovalDecision: setting?.onApprovalDecision ?? true,
          onNewInbox: setting?.onNewInbox ?? false,
          onQueueEmpty: setting?.onQueueEmpty ?? true,
          onDraftUpdated: setting?.onDraftUpdated ?? true,
          onModerationAlert: setting?.onModerationAlert ?? true,
        }}
        pages={pages}
        initialMutes={mutes.map((mute) => `${mute.targetId}:${mute.event}`)}
      />

      {admin && (
        <ChatChannelsClient
          channels={channels.map((channel) => ({
            id: channel.id,
            kind: channel.kind as 'slack' | 'telegram',
            name: channel.name,
            events: channel.events as never,
            enabled: channel.enabled,
            lastError: channel.lastError,
            lastSent: channel.lastSentAt ? formatInZone(channel.lastSentAt, auth.workspace.timezone, 'd MMM, HH:mm') : null,
          }))}
        />
      )}
    </div>
  );
}
