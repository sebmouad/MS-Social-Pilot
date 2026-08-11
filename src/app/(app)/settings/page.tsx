import { canManageInstance, canManageSettings } from '@/lib/constants';
import { getTranslations } from 'next-intl/server';

import { SettingsNav } from '@/components/SettingsNav';
import { SettingsClient } from '@/components/SettingsClient';
import { requirePage } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { bulkCsvTemplate } from '@/lib/csv';
import { aiAvailable } from '@/lib/ai';
import { env } from '@/lib/env';

export const dynamic = 'force-dynamic';

/**
 * Timezone list. `Intl.supportedValuesOf` gives the full IANA set on modern
 * Node; the fallback keeps the select usable on runtimes that lack it.
 */
function timezoneOptions(): string[] {
  const supported = (
    Intl as unknown as { supportedValuesOf?: (key: string) => string[] }
  ).supportedValuesOf;

  if (typeof supported === 'function') {
    try {
      return supported('timeZone');
    } catch {
      // Fall through.
    }
  }
  return [
    'UTC',
    'Europe/London',
    'Europe/Paris',
    'Europe/Berlin',
    'Africa/Casablanca',
    'America/New_York',
    'America/Chicago',
    'America/Los_Angeles',
    'Asia/Dubai',
    'Asia/Kolkata',
    'Asia/Singapore',
    'Australia/Sydney',
  ];
}

export default async function SettingsPage() {
  const auth = await requirePage();
  const t = await getTranslations('settings');

  const [slots, targets, workspace] = await Promise.all([
    prisma.queueSlot.findMany({
      where: { workspaceId: auth.workspace.id },
      orderBy: [{ dayOfWeek: 'asc' }, { hour: 'asc' }, { minute: 'asc' }],
    }),
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
        <h1 className="text-xl font-semibold text-slate-900">{t('title')}</h1>
        <p className="mt-1 text-sm text-slate-600">{t('subtitle')}</p>
      </header>

      <SettingsNav showConfig={canManageInstance(auth.role)} />

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
          utmSource: workspace.utmSource ?? '',
          utmMedium: workspace.utmMedium ?? '',
          utmCampaignTemplate: workspace.utmCampaignTemplate ?? '',
          shortenerEnabled: workspace.shortenerEnabled,
          aiEnabled: workspace.aiEnabled,
          aiTone: workspace.aiTone ?? '',
          aiBrandVoice: workspace.aiBrandVoice ?? '',
        }}
        slots={slots.map((slot) => ({
          dayOfWeek: slot.dayOfWeek,
          hour: slot.hour,
          minute: slot.minute,
        }))}
        targets={targets.map((target) => ({
          id: target.id,
          name: target.name,
          type: target.type,
          pictureUrl: target.pictureUrl,
          canPublish: target.canPublish && target.enabled,
          publishBlocker: target.publishBlocker,
          accountName: target.socialAccount?.name ?? null,
        }))}
      />
    </div>
  );
}
