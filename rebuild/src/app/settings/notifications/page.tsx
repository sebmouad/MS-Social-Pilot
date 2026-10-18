import type { Metadata } from 'next';
import { PageFrame } from '@/server/PageFrame';
import { requireViewer } from '@/server/context';
import { listNotifications, readNotificationPreferences } from '@/modules/settings/notifications/server';
import { SettingsPage, SettingsPanel } from '../_components';
import { NotificationCenter } from './NotificationCenter';

export const metadata: Metadata = { title: 'Notifications' };

export default async function NotificationsPage() {
  const viewer = await requireViewer({ feature: 'settings/notifications', channelScoped: true });
  const actor = { userId: viewer.user.id, workspaceId: viewer.workspaceId };
  const [preferences, notifications] = await Promise.all([
    readNotificationPreferences(actor).catch(() => null),
    listNotifications(actor, { page: 1 }).catch(() => null),
  ]);

  return <PageFrame module="settings" scopedAccess>
    <SettingsPage active="settings/notifications" title="Notifications" description={`Your personal alerts for ${viewer.membership.workspace.name}.`}>
      <SettingsPanel title="Your notification preferences" detail="Email choices belong to your account. Channel mutes apply only to empty-queue email alerts.">
        <NotificationCenter initialPreferences={preferences} initialPage={notifications} />
      </SettingsPanel>
    </SettingsPage>
  </PageFrame>;
}
