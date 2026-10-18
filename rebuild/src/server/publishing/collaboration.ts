import { QUEUE_SCHEDULER } from '@/modules/publishing/collaboration/server/executors';
import { collaborationPorts, registerCollaborationPorts, type VersionRestorePort } from '@/modules/publishing/collaboration/ports';

// Construct the lifecycle lazily: it records versions through the collaboration
// service, so eager construction would introduce a module initialization cycle.
const versions: VersionRestorePort = {
  async restorePostVersion(input) {
    const lifecycle = await import('./lifecycle');
    return lifecycle.restorePostVersion(input);
  },
};

/** Each server entry point installs its own bundle's ports before discovery or use.
 * No route depends on another route having been visited in the same process. */
export function ensurePublishingCollaboration() {
  const current = collaborationPorts();
  if (!current.versions || !current.queue) registerCollaborationPorts({ ...current, versions: current.versions ?? versions, queue: current.queue ?? QUEUE_SCHEDULER });
}
