import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { prisma } from '@/server/data';
import { requireViewer } from '@/server/context';
import { authorizeAi } from '../../server/access';
import { toolsCopy, type Locale } from '../server/copy-loader';
import { aiMediaStatus, listVideos } from '../server/media';
import { AiStudioScreen } from './AiStudioScreen';
import { StudioLinks } from '../../ui/StudioLinks';

export default async function AiStudioPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const viewer = await requireViewer({ module: 'studio', feature: 'studio/ai-studio', channelScoped: true });
  const locale: Locale = (await headers()).get('accept-language')?.toLowerCase().startsWith('fr') ? 'fr' : 'en';
  const actor = { userId: viewer.user.id, workspaceId: viewer.workspaceId };
  const [status, copy, auth, params] = await Promise.all([
    aiMediaStatus(actor, { locale }),
    toolsCopy(locale),
    authorizeAi(actor, 'studio/ai-studio', 'write').catch(() => null),
    searchParams ?? Promise.resolve({} as Record<string, string | string[] | undefined>),
  ]);
  const canCheck = auth !== null;
  const availableTabs = [
    ...(status.image.available ? ['image'] : []),
    ...(status.video.available ? ['video'] : []),
    ...(status.voice.available ? ['voice'] : []),
    ...(canCheck ? ['check'] : []),
  ];
  const requestedTab = typeof params.tab === 'string' ? params.tab : Array.isArray(params.tab) ? params.tab[0] : undefined;
  if (requestedTab !== undefined && !availableTabs.includes(requestedTab)) {
    const nextParams = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (key === 'tab' || value === undefined) continue;
      if (Array.isArray(value)) value.forEach(item => nextParams.append(key, item));
      else nextParams.set(key, value);
    }
    if (availableTabs[0]) nextParams.set('tab', availableTabs[0]);
    const query = nextParams.toString();
    redirect(query ? `/content/ai-studio?${query}` : '/content/ai-studio');
  }
  const [videos, channels] = await Promise.all([
    status.video.available ? listVideos(actor, { locale }).then(result => result.videos).catch(() => []) : [],
    auth ? prisma.target.findMany({ where: { workspaceId: viewer.workspaceId, enabled: true, ...(auth.allowedTargetIds ? { id: { in: auth.allowedTargetIds } } : {}) }, orderBy: { name: 'asc' }, take: 200, select: { id: true, name: true } }) : [],
  ]);
  const serialisableVideos = videos.map(video => ({ ...video, createdAt: video.createdAt.toISOString() }));
  return <>
    <AiStudioScreen status={status} videos={serialisableVideos} channels={channels} canCheck={canCheck} copy={copy} locale={locale} initialTab={requestedTab} />
    <StudioLinks copy={copy} />
  </>;
}
