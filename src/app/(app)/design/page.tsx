import { getTranslations } from 'next-intl/server';

import { DesignEditor } from '@/components/DesignEditor';
import { ScreenHeader } from '@/components/ScreenHeader';
import { AiVideoPanel } from '@/components/AiVideoPanel';
import { imageAvailable } from '@/lib/ai-image';
import { listVideos, videoAvailable } from '@/lib/ai-video';
import { canCompose } from '@/lib/constants';
import { requirePage } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { screenMetadata } from '@/lib/metadata';

export const dynamic = 'force-dynamic';

export function generateMetadata() {
  return screenMetadata('design.title');
}

/** A small editor for post pictures: a size, a background, some text, then into the media library. */
export default async function DesignPage() {
  const auth = await requirePage();
  const t = await getTranslations('design');
  const workspace = await prisma.workspace.findUniqueOrThrow({ where: { id: auth.workspace.id }, select: { aiEnabled: true } });
  const videos = workspace.aiEnabled && videoAvailable() && canCompose(auth.role) ? await listVideos(auth.workspace.id) : null;
  return (
    <div className="space-y-6">
      <ScreenHeader title={t('title')} subtitle={t('subtitle')} />
      <DesignEditor canGenerate={workspace.aiEnabled && imageAvailable()} />
      {videos && (
        <AiVideoPanel
          initial={videos.map((video) => ({ id: video.id, prompt: video.prompt, aspectRatio: video.aspectRatio, status: video.status as 'working' | 'ready' | 'failed', mediaId: video.mediaId, error: video.error }))}
        />
      )}
    </div>
  );
}
