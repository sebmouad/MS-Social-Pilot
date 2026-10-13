import { ScreenHeader } from '@/components/ScreenHeader';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { WebhooksClient } from '@/components/WebhooksClient';
import { requirePage } from '@/lib/auth';
import { canManageSettings } from '@/lib/constants';
import { screenMetadata } from '@/lib/metadata';
import { prisma } from '@/lib/prisma';
import { formatInZone } from '@/lib/time';

export const dynamic = 'force-dynamic';

export function generateMetadata() {
  return screenMetadata('webhooks.title');
}

/** Outgoing webhooks: owners and admins. */
export default async function WebhooksPage() {
  const auth = await requirePage();
  if (!canManageSettings(auth.role)) notFound();
  const t = await getTranslations('webhooks');
  const webhooks = await prisma.webhookEndpoint.findMany({
    where: { workspaceId: auth.workspace.id },
    orderBy: { createdAt: 'asc' },
    select: { id: true, name: true, url: true, events: true, enabled: true, lastError: true, lastSentAt: true, apiTokenId: true },
  });

  return (
    <div className="space-y-6">
      <ScreenHeader title={t('title')} subtitle={t('subtitle')} />
      <WebhooksClient
        webhooks={webhooks.map((webhook) => ({
          id: webhook.id,
          name: webhook.name,
          url: webhook.url,
          events: webhook.events as never,
          enabled: webhook.enabled,
          lastError: webhook.lastError,
          lastSent: webhook.lastSentAt ? formatInZone(webhook.lastSentAt, auth.workspace.timezone, 'd MMM yyyy, HH:mm') : null,
          viaApi: webhook.apiTokenId !== null,
        }))}
      />
    </div>
  );
}
