import { headers } from 'next/headers';
import { prisma } from '@/server/data';
import { requireViewer } from '@/server/context';
import { authorizeAi } from '../../server/access';
import { toolsCopy, type Locale } from '../server/copy-loader';
import { aiMediaStatus, listVideos } from '../server/media';
import { AiStudioScreen } from './AiStudioScreen';

export default async function AiStudioPage() {
  const viewer = await requireViewer({ module: 'publishing', feature: 'publishing/ai-studio', channelScoped: true });
  const locale: Locale = (await headers()).get('accept-language')?.toLowerCase().startsWith('fr') ? 'fr' : 'en';
  const actor = { userId: viewer.user.id, workspaceId: viewer.workspaceId };
  const [status, copy, auth] = await Promise.all([aiMediaStatus(actor, { locale }), toolsCopy(locale), authorizeAi(actor, 'publishing/ai-studio', 'write').catch(() => null)]);
  const [videos, channels] = await Promise.all([
    status.video.available ? listVideos(actor, { locale }).then(result => result.videos).catch(() => []) : [],
    auth ? prisma.target.findMany({ where: { workspaceId: viewer.workspaceId, enabled: true, ...(auth.allowedTargetIds ? { id: { in: auth.allowedTargetIds } } : {}) }, orderBy: { name: 'asc' }, take: 200, select: { id: true, name: true } }) : [],
  ]);
  const serialisableVideos = videos.map(video => ({ ...video, createdAt: video.createdAt.toISOString() }));
  return <AiStudioScreen status={status} videos={serialisableVideos} channels={channels} canCheck={auth !== null} copy={copy} locale={locale} />;
}
