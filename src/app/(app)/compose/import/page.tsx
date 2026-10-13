import { screenMetadata } from '@/lib/metadata';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { BulkUpload } from '@/components/BulkUpload';
import { ScreenHeader } from '@/components/ScreenHeader';
import { requirePage } from '@/lib/auth';
import { canCompose } from '@/lib/constants';
import { targetScope } from '@/lib/page-access';
import { prisma } from '@/lib/prisma';
import { bulkCsvTemplate } from '@/lib/csv';
export const dynamic = 'force-dynamic';
export function generateMetadata() { return screenMetadata('settings.bulk'); }
export default async function ImportPage() {
  const auth = await requirePage();
  if (!canCompose(auth.role)) redirect('/calendar');
  const t = await getTranslations('settings');
  const tCompose = await getTranslations('compose');
  const targets = await prisma.target.findMany({ where: { workspaceId: auth.workspace.id, ...targetScope(auth.pageScope) }, include: { socialAccount: { select: { name: true } } }, orderBy: [{ type: 'asc' }, { name: 'asc' }] });
  return <div className="space-y-6"><ScreenHeader title={t('bulk')} subtitle={t('bulkColumns', { timezone: auth.workspace.timezone })} /><BulkUpload key={`${auth.user.id}:${auth.workspace.id}`} timezone={auth.workspace.timezone} csvTemplate={bulkCsvTemplate()} targets={targets.map(target => ({ id: target.id, name: target.name, type: target.type, pictureUrl: target.pictureUrl, canPublish: target.canPublish && target.enabled, publishBlocker: target.enabled ? target.publishBlocker : tCompose('targetPaused'), publishBlockerCode: target.enabled ? target.publishBlockerCode : null, accountName: target.socialAccount?.name ?? null }))} /></div>;
}
