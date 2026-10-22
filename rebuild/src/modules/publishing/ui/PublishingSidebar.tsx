import type { ComponentProps } from 'react';
import { requireViewer } from '@/server/context';
import { loadPublishingCopy } from '../server/customer-copy';
import { loadPublishingActionCopy } from '../server/action-copy';
import { PublishingCopyProvider } from './kit/CopyProvider';
import { PublishingActionCopyProvider } from './WorkflowSubmitButtons';
import { PublishingSidebarClient } from './PublishingSidebarClient';
import { originFilterOptions } from './origins/load';
import { calendarExtrasLinks } from '@/modules/calendar-extras/server/links';

/** The shell mounts this server boundary separately from the route content. */
export async function PublishingSidebar(props: Omit<ComponentProps<typeof PublishingSidebarClient>, 'origins' | 'calendarLinks'>) {
  const [{ catalog }, actionCatalog, origins, calendarLinks] = await Promise.all([
    loadPublishingCopy(), loadPublishingActionCopy(),
    // The origin filter only offers origins this workspace has; a lookup failure just hides it.
    requireViewer({ module: 'publishing', channelScoped: true }).then(viewer => originFilterOptions(viewer.workspaceId, props.locale ?? 'en')).catch(() => []),
    calendarExtrasLinks(props.locale ?? 'en', ['dates', 'seasons', 'trends', 'feeds']),
  ]);
  return <PublishingCopyProvider catalog={catalog} locale={props.locale}>
    <PublishingActionCopyProvider catalog={actionCatalog} locale={props.locale}>
      <PublishingSidebarClient {...props} origins={origins} calendarLinks={calendarLinks} />
    </PublishingActionCopyProvider>
  </PublishingCopyProvider>;
}
