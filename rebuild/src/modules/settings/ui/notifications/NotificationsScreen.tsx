import { readSettingsUiCopy } from '@/modules/settings/ui/copy-server';
import type { Metadata } from 'next';
import { PageFrame } from '@/server/PageFrame';
import { requireViewer } from '@/server/context';
import { listNotifications, readNotificationPreferences } from '@/modules/settings/notifications/server';
import { SettingsPage, SettingsPanel } from '@/modules/settings/ui/_components';
import { fill } from '@/modules/settings/ui/shell-copy';
import { NotificationCenter } from './NotificationCenter';


export const metadata: Metadata = { title: 'Notifications' };

export default async function NotificationsPage() {
  const viewer = await requireViewer({ feature: 'settings/notifications', channelScoped: true });
  const actor = { userId: viewer.user.id, workspaceId: viewer.workspaceId };
  const [preferences, notifications] = await Promise.all([
    readNotificationPreferences(actor).catch(() => null),
    listNotifications(actor, { page: 1 }).catch(() => null),
  ]);
  // The saved personal locale drives this screen, matching NotificationCenter.
  const locale = preferences?.locale ?? 'en';
  const uiCopy = await readSettingsUiCopy();
  const t = uiCopy.notifications[locale];

  return <PageFrame module="settings" scopedAccess>
    <SettingsPage copy={uiCopy} active="settings/notifications" title={t.title} locale={locale} description={fill(t.description, { workspace: viewer.membership.workspace.name })}>
      <SettingsPanel title={t.panel} detail={t.panelDetail}>
        <NotificationCenter initialPreferences={preferences} initialPage={notifications} locale={locale} />
      </SettingsPanel>
    </SettingsPage>
  </PageFrame>;
}
