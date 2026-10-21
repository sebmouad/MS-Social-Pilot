import { webhookCopySchema } from '../config';
import { runtimeConfig } from '@/server/config/store';
import { PageHeader } from '@/components/PageHeader';
import { headers } from 'next/headers';
import { PageFrame } from '@/server/PageFrame';
import { requireViewer } from '@/server/context';
import { SettingsPanel, styles } from '@/modules/settings/ui/_components';
import { EMITTED_EVENTS } from '../contracts';
import { WEBHOOKS_FEATURE_ID } from '../manifest';
import { integrationsLocale, type IntegrationsCopyKey } from '../copy';
import { listWebhooks } from '../server/webhooks';
import { WebhookManager } from './WebhookManager';

export const metadata = { title: 'Webhooks' };

export default async function WebhooksScreen() {
  const locale = integrationsLocale((await headers()).get('accept-language'));
  const catalog = webhookCopySchema.parse(await runtimeConfig('integrations.webhookCopy'));
  const copy = catalog[locale];
  const t = (key: IntegrationsCopyKey, vars?: Record<string, string | number>) => Object.entries(vars ?? {}).reduce((value: string, [name, item]) => value.split(`{${name}}`).join(String(item)), copy[key]);
  const viewer = await requireViewer({ feature: WEBHOOKS_FEATURE_ID, channelScoped: true });
  const frame = (body: React.ReactNode) => <PageFrame module="settings">
    <div className={styles['settings-page']}>
      <PageHeader module="settings" title={t('title')} description={t('description', { workspace: viewer.membership.workspace.name })} />
      {body}
    </div>
  </PageFrame>;
  if (viewer.membership.role !== 'owner' && viewer.membership.role !== 'admin') return frame(<SettingsPanel title={t('restricted')}><p className={styles['settings-note']}>{t('restrictedBody')}</p></SettingsPanel>);
  let data: Awaited<ReturnType<typeof listWebhooks>> | null = null;
  try { data = await listWebhooks({ userId: viewer.user.id, workspaceId: viewer.workspaceId }); } catch { data = null; }
  if (!data) return frame(<SettingsPanel title={t('title')}><p role="alert" className={styles['settings-note']}>{t('loadFailed')}</p></SettingsPanel>);
  if (!data.available) return frame(<SettingsPanel title={t('title')}><p className={styles['settings-note']}>{t('unavailable')}</p></SettingsPanel>);
  const webhooks = data.webhooks.map(({ createdAt: _createdAt, ...hook }) => ({ ...hook, lastSentAt: hook.lastSentAt?.toISOString() ?? null }));
  return frame(<>
    <SettingsPanel title={t('endpoints')} detail={t('endpointsDetail')}>
      <WebhookManager initial={webhooks} events={data.events} emitted={[...EMITTED_EVENTS]} maxEndpoints={data.maxEndpoints} copy={copy} nameMaxLength={data.nameMaxLength} urlMaxLength={data.urlMaxLength} locale={locale} />
    </SettingsPanel>
    <p className={styles['settings-note']}>{t('verifyNote')}</p>
  </>);
}
