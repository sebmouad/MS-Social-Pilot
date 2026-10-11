import { getTranslations } from 'next-intl/server';

import { ApiTokensClient } from '@/components/ApiTokensClient';
import { requirePage } from '@/lib/auth';
import { canManageSettings } from '@/lib/constants';
import { env } from '@/lib/env';
import { screenMetadata } from '@/lib/metadata';
import { prisma } from '@/lib/prisma';
import { formatInZone } from '@/lib/time';

export const dynamic = 'force-dynamic';

export function generateMetadata() {
  return screenMetadata('apiKeys.title');
}

/** Keys for the API and for Claude through MCP, and how to connect them. */
export default async function ApiKeysPage() {
  const auth = await requirePage();
  const t = await getTranslations('apiKeys');
  const admin = canManageSettings(auth.role);
  const tokens = await prisma.apiToken.findMany({
    where: { workspaceId: auth.workspace.id, ...(admin ? {} : { userId: auth.user.id }) },
    orderBy: { createdAt: 'desc' },
    include: { user: { select: { name: true } } },
  });
  const base = env.appUrl.replace(/\/$/, '');
  const when = (date: Date | null) => (date ? formatInZone(date, auth.workspace.timezone, 'd MMM yyyy, HH:mm') : null);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">{t('title')}</h1>
        <p className="mt-1 text-sm text-slate-600">{t('subtitle')}</p>
      </header>
      <ApiTokensClient
        baseUrl={base}
        showOwner={admin}
        tokens={tokens.map((token) => ({
          id: token.id,
          name: token.name,
          prefix: token.prefix,
          scope: token.scope as 'read' | 'write',
          owner: token.user.name,
          created: when(token.createdAt)!,
          lastUsed: when(token.lastUsedAt),
          revoked: token.revokedAt !== null,
        }))}
      />
    </div>
  );
}
