import { canManageSettings } from '@/lib/constants';
import { getTranslations } from 'next-intl/server';

import { SettingsClient } from '@/components/SettingsClient';
import { requirePage } from '@/lib/auth';
import { timezoneOptions } from '@/lib/time';
import { screenMetadata } from '@/lib/metadata';
import { prisma } from '@/lib/prisma';
import { bulkCsvTemplate } from '@/lib/csv';
import { aiAvailable } from '@/lib/ai';
import { env } from '@/lib/env';

export const dynamic = 'force-dynamic';

/** The tab says which screen and which client, so several open at once stay apart. */
export function generateMetadata() {
  return screenMetadata('settings.workspace');
}


export default async function SettingsPage() {
  const auth = await requirePage();
  const t = await getTranslations('settings');

  const [targets, workspace] = await Promise.all([
    prisma.target.findMany({
      where: { workspaceId: auth.workspace.id },
      include: { socialAccount: { select: { name: true } } },
      orderBy: [{ type: 'asc' }, { name: 'asc' }],
    }),
    prisma.workspace.findUniqueOrThrow({ where: { id: auth.workspace.id } }),
  ]);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold sm:text-2xl text-slate-900">{t('title')}</h1>
        <p className="mt-1 text-sm text-slate-600">{t('subtitle')}</p>
      </header>

      <SettingsClient
        canManage={canManageSettings(auth.role)}
        workspaceName={auth.workspace.name}
        timezone={auth.workspace.timezone}
        timezones={timezoneOptions()}
        csvTemplate={bulkCsvTemplate()}
        aiConfigured={aiAvailable()}
        shortLinkBase={env.shortLinkBase}
        options={{
          requiresApproval: workspace.requiresApproval,
          weekStartsOn: workspace.weekStartsOn,
          businessDays: workspace.businessDays,
          businessStart: workspace.businessStart,
          businessEnd: workspace.businessEnd,
          utmSource: workspace.utmSource ?? '',
          utmMedium: workspace.utmMedium ?? '',
          utmCampaignTemplate: workspace.utmCampaignTemplate ?? '',
          shortenerEnabled: workspace.shortenerEnabled,
          spamGapMinutes: workspace.spamGapMinutes,
          undoSendSeconds: workspace.undoSendSeconds,
          bestTimeMode: workspace.bestTimeMode === 'apply' ? 'apply' : 'suggest',
          audienceCountries: workspace.audienceCountries,
          audienceLanguages: workspace.audienceLanguages,
          audienceTimezone: workspace.audienceTimezone,
          audienceCalendars: workspace.audienceCalendars,
          aiEnabled: workspace.aiEnabled,
          watchNegativeComments: workspace.watchNegativeComments,
          aiTone: workspace.aiTone ?? '',
          aiBrandVoice: workspace.aiBrandVoice ?? '',
        }}
        targets={targets.map((target) => ({
          id: target.id,
          name: target.name,
          type: target.type,
          pictureUrl: target.pictureUrl,
          canPublish: target.canPublish && target.enabled,
          publishBlocker: target.publishBlocker,
          publishBlockerCode: target.publishBlockerCode,
          accountName: target.socialAccount?.name ?? null,
        }))}
      />
    </div>
  );
}
