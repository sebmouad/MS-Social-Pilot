import { PageFrame } from '@/server/PageFrame';
import { requireViewer } from '@/server/context';
import { listWebhooks } from '@/modules/integrations/server/webhooks';
import { SettingsPage, SettingsPanel, styles } from '../_components';
import { WebhookManager } from './WebhookManager';

export const metadata = { title: 'Webhooks' };

export default async function WebhooksPage() {
  const viewer = await requireViewer({ feature: 'settings/mcp', channelScoped: true });
  const frame = (body: React.ReactNode) => <PageFrame module="settings"><SettingsPage active="settings/mcp" title="Webhooks" description={`Send events from ${viewer.membership.workspace.name} to tools like Zapier, Make or your own server.`}>{body}</SettingsPage></PageFrame>;
  if (viewer.membership.role !== 'owner' && viewer.membership.role !== 'admin') return frame(<SettingsPanel title="Access restricted"><p className={styles['settings-note']}>Only workspace owners and admins can manage webhooks.</p></SettingsPanel>);
  let data: Awaited<ReturnType<typeof listWebhooks>> | null = null;
  try { data = await listWebhooks({ userId: viewer.user.id, workspaceId: viewer.workspaceId }); } catch { data = null; }
  if (!data) return frame(<SettingsPanel title="Webhooks"><p role="alert" className={styles['settings-note']}>Webhooks could not be loaded. Refresh the page to try again.</p></SettingsPanel>);
  if (!data.available) return frame(<SettingsPanel title="Webhooks"><p className={styles['settings-note']}>Webhooks are not available right now.</p></SettingsPanel>);
  const webhooks = data.webhooks.map(({ createdAt: _createdAt, ...hook }) => ({ ...hook, lastSentAt: hook.lastSentAt?.toISOString() ?? null }));
  return frame(<>
    <SettingsPanel title="Endpoints" detail="Each event is sent as signed JSON. A failed delivery is retried a few times, then listed as given up."><WebhookManager initial={webhooks} events={data.events} maxEndpoints={data.maxEndpoints} /></SettingsPanel>
    <p className={styles['settings-note']}>Check the X-MSP-Signature header (HMAC-SHA256 of the timestamp, a dot and the body, using your signing secret) and use the delivery id to ignore repeats. Only public https addresses are accepted.</p>
  </>);
}
