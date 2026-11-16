import { settingsLocale } from '../locale';
import { readSettingsUiCopy } from '@/modules/settings/ui/copy-server';
import type { Metadata } from 'next';
import Link from 'next/link';
import { chatCopy as chatCopyCatalog } from '@/modules/notifications/chat-channels/server/policy';
import { PageFrame } from '@/server/PageFrame';
import { requireViewer } from '@/server/context';
import { listNotifications, readNotificationPreferences } from '@/modules/settings/notifications/server';
import { SettingsPage, SettingsPanel } from '@/modules/settings/ui/_components';
import { fill } from '@/modules/settings/ui/shell-copy';
import { labelInstants, workspaceInstantFormatter } from '@/server/instant-labels';
import { NotificationCenter } from './NotificationCenter';
import { RouteNotice } from '@/components/RouteNotice';


export const metadata: Metadata = { title: 'Notifications' };

export default async function NotificationsPage() {
  const viewer = await requireViewer({ feature: 'settings/notifications', channelScoped: true });
  const actor = { userId: viewer.user.id, workspaceId: viewer.workspaceId };
  const [preferences, notifications, mailReady] = await Promise.all([
    readNotificationPreferences(actor).catch(() => null),
    listNotifications(actor, { page: 1 }).catch(() => null),
    import('@/server/mail').then(mail => mail.mailReady()).catch(() => true),
  ]);
  // The screen follows the app's language like every other page (2026-11-15); the saved personal locale only
  // chooses the language of the emails themselves.
  const locale = await settingsLocale();
  const instants = await workspaceInstantFormatter(viewer.workspaceId, locale);
  const uiCopy = await readSettingsUiCopy();
  const t = uiCopy.notifications[locale];
  // Chat destinations are managed by workspace owners and admins only (the service enforces this too).
  const canManageChat = viewer.membership.role === 'owner' || viewer.membership.role === 'admin';
  const chatCopy = canManageChat ? await chatCopyCatalog().then(copy => copy[locale]).catch(() => null) : null;

  return <PageFrame module="settings" scopedAccess>
    <SettingsPage copy={uiCopy} tab="accountNotifications" active="settings/notifications" title={t.title} locale={locale} description={fill(t.description, { workspace: viewer.membership.workspace.name })}>
      {/* The email switches mean nothing while no mail provider is set up (2026-11-16): say so instead of failing quietly. */}
      {!mailReady ? <RouteNotice focusKey="mail-unavailable">{locale === 'fr' ? 'Les e-mails ne sont pas encore configurés pour cette installation : les notifications restent dans l’application. Un administrateur peut ajouter le service d’envoi dans les réglages Root (e-mail).' : 'Email is not set up for this installation yet: notifications stay in the app. An administrator can add the mail service in the Root settings (email).'}</RouteNotice> : null}
      <SettingsPanel title={t.panel} detail={t.panelDetail}>
        <NotificationCenter initialPreferences={preferences} initialPage={notifications && { ...notifications, items: notifications.items.map(item => labelInstants(item, { createdAt: 'dateTime' }, instants)) }} locale={locale} />
      </SettingsPanel>
      {chatCopy ? <SettingsPanel title={chatCopy.title} detail={chatCopy.description}>
        <Link href="/settings/account/notifications/chat-channels">{chatCopy.title}</Link>
      </SettingsPanel> : null}
    </SettingsPage>
  </PageFrame>;
}
