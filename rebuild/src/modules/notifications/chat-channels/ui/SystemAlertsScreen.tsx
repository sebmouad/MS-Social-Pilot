import { headers } from 'next/headers';
import { requireRootPage } from '@/server/config/access';
import { RootFrame } from '@/server/root/RootFrame';
import { PageHeader } from '@/components/PageHeader';
import { rootCopyLocale } from '@/server/root/legacy/copy';
import { ALERT_COPY } from '../alerts-config';
import { listSystemAlerts } from '../server/alerts';
import { SystemAlerts } from './SystemAlerts';

export default async function SystemAlertsScreen() {
  const actor = await requireRootPage();
  const locale = rootCopyLocale((await headers()).get('accept-language'));
  const snapshot = await listSystemAlerts(actor.id).catch(() => null);
  const copy = snapshot?.copy[locale] ?? ALERT_COPY[locale];
  return <RootFrame active="/root/alerts"><PageHeader module="root" title={copy.title} description={copy.intro} />
    {snapshot ? <SystemAlerts snapshot={snapshot} copy={copy} locale={locale} /> : <p role="alert">{copy.unavailable}</p>}
  </RootFrame>;
}
