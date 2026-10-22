import { PageFrame } from '@/server/PageFrame';
import { requireViewer } from '@/server/context';
import { PageHeader } from '@/components/PageHeader';
import { settingsLocale } from '@/modules/settings/ui/locale';
import { listChatChannels } from '../server/service';
import { CHAT_COPY } from '../config';
import { ChatChannels } from './ChatChannels';

export default async function ChatChannelsScreen() {
  const viewer = await requireViewer({ feature: 'settings/notifications' });
  const locale = await settingsLocale();
  const snapshot = await listChatChannels({ userId: viewer.user.id, workspaceId: viewer.workspaceId }).catch(() => null);
  const copy = snapshot?.copy[locale] ?? CHAT_COPY[locale];
  return <PageFrame module="settings"><PageHeader module="settings" title={copy.title} description={copy.description} />
    {snapshot ? <ChatChannels initial={snapshot.channels} policy={snapshot.policy} copy={copy} locale={locale} timeZone={viewer.membership.workspace.timezone} /> : <p role="alert">{copy.unavailable}</p>}
  </PageFrame>;
}
