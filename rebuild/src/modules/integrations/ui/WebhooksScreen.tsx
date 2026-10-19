import { headers } from 'next/headers';
import { PageFrame } from '@/server/PageFrame';
import { requireViewer } from '@/server/context';
import { SettingsPanel, styles } from '@/modules/settings/ui/_components';
import { EMITTED_EVENTS } from '../contracts';
import { WEBHOOKS_FEATURE_ID } from '../manifest';
import { integrationsCopyFor, integrationsLocale, integrationsText } from '../copy';
import { listWebhooks } from '../server/webhooks';
import { WebhookManager } from './WebhookManager';

export const metadata = { title: 'Webhooks' };

export default async function WebhooksScreen() {
  const locale = integrationsLocale((await headers()).get('accept-language'));
  const t = (key: Parameters<typeof integrationsText>[1], vars?: Record<string, string | number>) => integrationsText(locale, key, vars);
  const viewer = await requireViewer({ feature: WEBHOOKS_FEATURE_ID, channelScoped: true });
  const frame = (body: React.ReactNode) => <PageFrame module="settings">
    <div className={styles['settings-page']}>
      <header className={styles['settings-heading']}><div><p className={styles['settings-eyebrow']}>{t('eyebrow')}</p><h1>{t('title')}</h1><p>{t('description', { workspace: viewer.membership.workspace.name })}</p></div></header>
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
      <WebhookManager initial={webhooks} events={data.events} emitted={[...EMITTED_EVENTS]} maxEndpoints={data.maxEndpoints} copy={integrationsCopyFor(locale)} locale={locale} />
    </SettingsPanel>
    <p className={styles['settings-note']}>{t('verifyNote')}</p>
  </>);
}
