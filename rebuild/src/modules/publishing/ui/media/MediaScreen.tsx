import { requireViewer } from '@/server/context';
import { PageHeading } from '@/modules/publishing/ui/publishing-ui';
import { MediaLibrary } from './media-library';

export default async function MediaPage() {
  const viewer = await requireViewer({ feature: 'publishing/media', channelScoped: true });
  return <>
    <PageHeading title="Image library" description="Browse images stored in this workspace and see which ones are attached to posts." />
    <MediaLibrary canDelete={viewer.permissions.features['publishing/media'].write} />
  </>;
}
