import type { Metadata } from 'next';
import { PageFrame } from '@/server/PageFrame';
import { requireViewer } from '@/server/context';
import { authorizeSharing } from '@/modules/sharing/server/access';
import { listShareableChannels, listShareLinks } from '@/modules/sharing/server/links';
import { sharingLimits } from '@/modules/sharing/server/limits';
import { SHARING_FEATURE_ID } from '@/modules/sharing/semantics';
import type { FeatureId } from '@/lib/product';
import { SettingsPage, SettingsPanel, styles } from '../_components';
import { LinksManager } from './LinksManager';

export const metadata: Metadata = { title: 'Client sharing' };
export const dynamic = 'force-dynamic';

export default async function SharingPage() {
  const viewer = await requireViewer({ feature: SHARING_FEATURE_ID });
  const actor = { userId: viewer.user.id, workspaceId: viewer.workspaceId };
  const [links, channels, limits, auth] = await Promise.all([
    listShareLinks(actor).catch(() => null),
    listShareableChannels(actor).catch(() => null),
    sharingLimits().catch(() => null),
    authorizeSharing(actor, 'sharing', 'read').catch(() => null),
  ]);
  const ready = links && channels && limits && auth;
  return <PageFrame module="settings"><SettingsPage active={SHARING_FEATURE_ID as FeatureId} title="Client sharing" description={`Give clients limited access to ${viewer.membership.workspace.name} without an account.`}>
    <SettingsPanel title="Share links" detail="Review, calendar and portal links open without signing in, show only the channels you choose, and expire.">
      {ready
        ? <LinksManager initial={JSON.parse(JSON.stringify(links))} channels={channels} canApprove={auth.canApprove} limits={{ titleMax: limits.titleMaxCharacters!, descriptionMax: limits.descriptionMaxCharacters!, defaultExpiryDays: limits.defaultExpiryDays!, maxExpiryDays: limits.maxExpiryDays!, maxDaysBack: limits.maxDaysBack!, maxDaysAhead: limits.maxDaysAhead!, maxTargets: limits.maxTargetsPerLink! }} />
        : <p className={styles['settings-note']} role="alert">Share links are unavailable right now. <a href="/settings/sharing">Try again</a>.</p>}
    </SettingsPanel>
  </SettingsPage></PageFrame>;
}
