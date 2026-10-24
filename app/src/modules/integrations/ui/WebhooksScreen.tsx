import { configOrDefault } from '@/server/config/config-or-default';
import { webhookCopySchema } from '../config';
import { runtimeConfig } from '@/server/config/store';
import { PageHeader } from '@/components/PageHeader';
import { headers } from 'next/headers';
import { PageFrame } from '@/server/PageFrame';
import { requireViewer } from '@/server/context';
import { SectionTabs, SettingsPanel, styles } from '@/modules/settings/ui/_components';
import { EMITTED_EVENTS } from '../contracts';
import { WEBHOOKS_FEATURE_ID } from '../manifest';
import { integrationsLocale, type IntegrationsCopyKey } from '../copy';
import { labelInstants, workspaceInstantFormatter } from '@/server/instant-labels';
import { listWebhooks } from '../server/webhooks';
import { WebhookManager } from './WebhookManager';

export const metadata = { title: 'Webhooks' };

export default async function WebhooksScreen() {
  const locale = integrationsLocale((await headers()).get('accept-language'));
  const catalog = (await configOrDefault('integrations.webhookCopy', webhookCopySchema));
  const copy = catalog[locale];
  const t = (key: IntegrationsCopyKey, vars?: Record<string, string | number>) => Object.entries(vars ?? {}).reduce((value: string, [name, item]) => value.split(`{${name}}`).join(String(item)), copy[key]);
  const viewer = await requireViewer({ feature: WEBHOOKS_FEATURE_ID, channelScoped: true });
  const tabs = <SectionTabs tab="integrationsWebhooks" locale={locale} title={t('title')} />;
  const frame = (body: React.ReactNode) => <PageFrame module="settings">
    <div className={styles['settings-page']}>
      <PageHeader module="settings" title={t('title')} description={t('description', { workspace: viewer.membership.workspace.name })} tabs={tabs} />
      {body}
    </div>
  </PageFrame>;
  if (viewer.membership.role !== 'owner' && viewer.membership.role !== 'admin') return frame(<SettingsPanel title={t('restricted')}><p className={styles['settings-note']}>{t('restrictedBody')}</p></SettingsPanel>);
  let data: Awaited<ReturnType<typeof listWebhooks>> | null = null;
  try { data = await listWebhooks({ userId: viewer.user.id, workspaceId: viewer.workspaceId }); } catch { data = null; }
  if (!data) return frame(<SettingsPanel title={t('title')}><p role="alert" className={styles['settings-note']}>{t('loadFailed')}</p></SettingsPanel>);
  if (!data.available) return frame(<SettingsPanel title={t('title')}><p className={styles['settings-note']}>{t('unavailable')}</p></SettingsPanel>);
  const instants = await workspaceInstantFormatter(viewer.workspaceId, locale);
  const webhooks = data.webhooks.map(({ createdAt: _createdAt, ...hook }) => labelInstants({ ...hook, lastSentAt: hook.lastSentAt?.toISOString() ?? null }, { lastSentAt: 'dateTime' }, instants));
  return frame(<>
    <SettingsPanel title={t('endpoints')} detail={t('endpointsDetail')}>
      <WebhookManager initial={webhooks} events={data.events} emitted={[...EMITTED_EVENTS]} maxEndpoints={data.maxEndpoints} copy={copy} nameMaxLength={data.nameMaxLength} urlMaxLength={data.urlMaxLength} locale={locale} />
    </SettingsPanel>
    <p className={styles['settings-note']}>{t('verifyNote')}</p>
  </>);
}
