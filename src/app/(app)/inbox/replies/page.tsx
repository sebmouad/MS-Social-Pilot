import { getTranslations } from 'next-intl/server';

import { EmptyState } from '@/components/EmptyState';
import { SavedRepliesClient } from '@/components/SavedRepliesClient';
import { requirePage } from '@/lib/auth';
import { canModerateComments } from '@/lib/constants';
import { screenMetadata } from '@/lib/metadata';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export function generateMetadata() {
  return screenMetadata('savedReplies.title');
}

/** The workspace's saved replies, offered in every comment and Messenger reply box. */
export default async function SavedRepliesPage() {
  const auth = await requirePage();
  const t = await getTranslations('savedReplies');

  if (!canModerateComments(auth.role)) {
    return (
      <div className="space-y-6">
        <h1 className="text-xl font-semibold sm:text-2xl text-slate-900">{t('title')}</h1>
        <EmptyState icon="comment" title={t('noAccessTitle')} hint={t('noAccessHint')} />
      </div>
    );
  }

  const replies = await prisma.savedReply.findMany({
    where: { workspaceId: auth.workspace.id },
    select: { id: true, name: true, body: true },
    orderBy: { name: 'asc' },
  });

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold sm:text-2xl text-slate-900">{t('title')}</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-600">{t('intro')}</p>
      </header>
      <SavedRepliesClient replies={replies} />
    </div>
  );
}
