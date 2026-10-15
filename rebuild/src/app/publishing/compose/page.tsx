import { requireViewer } from '@/server/context';
import { getTargets } from '@/server/data';
import { runtimeConfig } from '@/server/config/store';
import { hasPlatformCapability } from '@/server/entitlements';
import { canAccessFeature } from '@/server/permissions';
import { platformFor } from '@/server/platforms/registry';
import { isDateKey } from '@/lib/calendar-dates';
import { PageHeading } from '../publishing-ui';
import { PostEditorForm } from '../posts/PostActions';
import styles from '../publishing.module.css';

export default async function ComposePage({ searchParams }: { searchParams: Promise<{ date?: string; time?: string }> }) {
  const viewer = await requireViewer({ feature: 'publishing/posts', channelScoped: true });
  const params = await searchParams;
  const canCreate = canAccessFeature(viewer.permissions, 'publishing/posts', 'write');
  const [allowedMimeTypes, maxUploadBytes, maxAltCharacters, targets] = await Promise.all([
    runtimeConfig('publishing.allowedImageMimeTypes'), runtimeConfig('publishing.maxImageUploadBytes'),
    runtimeConfig('publishing.maxImageAltCharacters'), getTargets(viewer.workspaceId),
  ]);
  const scoped = targets.filter(target => viewer.permissions.pageScope.all || viewer.permissions.pageScope.ids.includes(target.id));
  const choices = await Promise.all(scoped.map(async target => {
    const provider = target.socialAccount?.provider ?? null;
    const adapter = provider && hasPlatformCapability(viewer.entitlements, provider) ? await platformFor(provider, 'publishing') : null;
    return { id: target.id, name: target.name, type: target.type, provider, canPublish: Boolean(target.canPublish && !target.socialAccount?.invalidatedAt && adapter?.publish && adapter.supportsTargetKind?.(target.type, 'publishing')) };
  }));
  const schedule = {
    date: params.date && isDateKey(params.date) ? params.date : '',
    time: params.time && /^([01]\d|2[0-3]):[0-5]\d$/.test(params.time) ? params.time : '',
    timeZone: viewer.membership.workspace.timezone,
  };
  return <>
    <PageHeading title="Create a post" description="Choose destinations, write your post, then save a draft or schedule it." />
    {canCreate ? <section className={`${styles.card} ${styles.createCard}`}><PostEditorForm targets={choices} imageRules={{ allowedMimeTypes: allowedMimeTypes as string[], maxUploadBytes: Number(maxUploadBytes), maxAltCharacters: Number(maxAltCharacters) }} schedule={schedule} /></section>
      : <section className={styles.card}><p>You do not have permission to create posts in this workspace.</p></section>}
  </>;
}
