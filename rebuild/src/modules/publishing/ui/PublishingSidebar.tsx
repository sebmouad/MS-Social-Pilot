import type { ComponentProps } from 'react';
import { requireViewer } from '@/server/context';
import { loadPublishingCopy } from '../server/customer-copy';
import { loadPublishingActionCopy } from '../server/action-copy';
import { PublishingCopyProvider } from './kit/CopyProvider';
import { PublishingActionCopyProvider } from './WorkflowSubmitButtons';
import { PublishingSidebarClient } from './PublishingSidebarClient';
import { originFilterOptions } from './origins/load';

/** The shell mounts this server boundary separately from the route content. */
export async function PublishingSidebar(props: Omit<ComponentProps<typeof PublishingSidebarClient>, 'origins'>) {
  const [{ catalog }, actionCatalog, origins] = await Promise.all([
    loadPublishingCopy(), loadPublishingActionCopy(),
    // The origin filter only offers origins this workspace has; a lookup failure just hides it.
    requireViewer({ module: 'publishing', channelScoped: true }).then(viewer => originFilterOptions(viewer.workspaceId, props.locale ?? 'en')).catch(() => []),
  ]);
  return <PublishingCopyProvider catalog={catalog} locale={props.locale}>
    <PublishingActionCopyProvider catalog={actionCatalog} locale={props.locale}>
      <PublishingSidebarClient {...props} origins={origins} />
    </PublishingActionCopyProvider>
  </PublishingCopyProvider>;
}
