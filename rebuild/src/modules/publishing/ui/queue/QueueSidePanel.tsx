import { configOrDefault } from '@/server/config/config-or-default';
import { queueDefaultSlotSchema } from '@/modules/publishing/queue-config';
import { ensurePublishingCollaboration } from '@/modules/publishing/server/collaboration';
import { collaborationCapabilities } from '@/modules/publishing/collaboration/ports';
import { bounds } from '@/modules/publishing/collaboration/server/core';
import { readQueueSlots } from '@/modules/publishing/collaboration/server/queue-slots';
import { readContentMix } from '@/modules/publishing/collaboration/server/content-mix';
import type { ContentCopy } from '../content-copy';
import { QueueTimes } from '../collaboration/QueueTimes';
import { ContentMix } from '../collaboration/ContentMix';
import styles from './queue.module.css';

/**
 * Right-hand panel of Content › Queue (design v2 S4): the weekly queue times, and the content mix under "Automation".
 * Both read through the same services as before (`readQueueSlots`, `readContentMix`); a failed or refused read only hides that part.
 */
export async function QueueSidePanel({ actor, timeZone, copy }: { actor: { userId: string; workspaceId: string }; timeZone: string; copy: ContentCopy }) {
  ensurePublishingCollaboration();
  const caps = collaborationCapabilities();
  const [times, mix] = await Promise.all([
    caps.queueTimes ? Promise.all([readQueueSlots(actor), bounds(), configOrDefault('publishing.queue.defaultSlot', queueDefaultSlotSchema)]).catch(() => null) : null,
    caps.contentMix ? readContentMix(actor).catch(() => null) : null,
  ]);
  return <aside className={styles.side} aria-label={copy.queueTimesTitle}>
    <section className={styles.sidePanel}>
      <h2>{copy.queueTimesTitle}</h2>
      {times
        ? <QueueTimes initialSlot={times[2]} timeZone={timeZone} slots={times[0].slots} targets={times[0].targets.map(({ id, name }) => ({ id, name }))} canEditShared={times[0].canEditShared} canEditChannels={times[0].canEditChannels} limit={times[1].queueSlotLimit} />
        : <p className={styles.muted}>{copy.queueTimesUnavailable}</p>}
    </section>
    {mix ? <details className={styles.automation}>
      <summary>{copy.queueAutomation}</summary>
      <ContentMix targets={mix.targets.map(({ id, name }) => ({ id, name }))} groups={mix.groups} labels={mix.labels.map(({ id, name }) => ({ id, name }))} rules={mix.rules} status={mix.status} windowDays={mix.windowDays} maxPerWeek={mix.maxPerWeek} mixAutoFill={mix.mixAutoFill} canEditChannels={mix.canEditChannels} canEditGroups={mix.canEditGroups} canEditAutoFill={mix.canEditAutoFill} />
    </details> : null}
  </aside>;
}
