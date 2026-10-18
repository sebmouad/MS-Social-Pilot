import { MIX_EXECUTOR, QUEUE_SCHEDULER, RECYCLE_EXECUTOR } from '@/modules/publishing/collaboration/server/executors';
import { collaborationPorts, registerCollaborationPorts, type VersionRestorePort } from '@/modules/publishing/collaboration/ports';
import { publishingManifest } from '@/modules/publishing/manifest';
import { runPublishingMix, runPublishingRecycle } from './automation';

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
  const hasRecycleJob = publishingManifest.jobs.some(job => job.name === 'publishingRecycle');
  const hasMixJob = publishingManifest.jobs.some(job => job.name === 'publishingMix');
  // These host exports are the worker's real lifecycle-safe job handlers. Their
  // presence and paired manifest declarations are required before advertising controls.
  const recycle = hasRecycleJob && typeof runPublishingRecycle === 'function' ? RECYCLE_EXECUTOR : undefined;
  const mix = hasMixJob && typeof runPublishingMix === 'function' ? MIX_EXECUTOR : undefined;
  if (!current.versions || !current.queue || (!!recycle && !current.recycle) || (!!mix && !current.mix)) {
    registerCollaborationPorts({ ...current, versions: current.versions ?? versions, queue: current.queue ?? QUEUE_SCHEDULER, ...(recycle ? { recycle: current.recycle ?? recycle } : {}), ...(mix ? { mix: current.mix ?? mix } : {}) });
  }
}
