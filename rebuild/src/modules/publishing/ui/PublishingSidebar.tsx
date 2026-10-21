import type { ComponentProps } from 'react';
import { loadPublishingCopy } from '../server/customer-copy';
import { loadPublishingActionCopy } from '../server/action-copy';
import { PublishingCopyProvider } from './kit/CopyProvider';
import { PublishingActionCopyProvider } from './WorkflowSubmitButtons';
import { PublishingSidebarClient } from './PublishingSidebarClient';

/** The shell mounts this server boundary separately from the route content. */
export async function PublishingSidebar(props: ComponentProps<typeof PublishingSidebarClient>) {
  const [{ catalog }, actionCatalog] = await Promise.all([loadPublishingCopy(), loadPublishingActionCopy()]);
  return <PublishingCopyProvider catalog={catalog} locale={props.locale}>
    <PublishingActionCopyProvider catalog={actionCatalog} locale={props.locale}>
      <PublishingSidebarClient {...props} />
    </PublishingActionCopyProvider>
  </PublishingCopyProvider>;
}
