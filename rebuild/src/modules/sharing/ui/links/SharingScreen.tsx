import type { Metadata } from 'next';
import { PageFrame } from '@/server/PageFrame';
import { requireViewer } from '@/server/context';
import { authorizeSharing } from '@/modules/sharing/server/access';
import { listShareableChannels, listShareLinks } from '@/modules/sharing/server/links';
import { loadOwnerCopy, sharingLimits } from '@/modules/sharing/server/limits';
import { ownerText } from '@/modules/sharing/ui/owner-copy';
import { settingsLocale } from '@/modules/settings/ui/locale';
import { SHARING_FEATURE_ID } from '@/modules/sharing/semantics';
import type { FeatureId } from '@/lib/product';
import { SettingsPage, SettingsPanel, styles } from '@/modules/settings/ui/_components';
import { LinksManager } from './LinksManager';

export const metadata: Metadata = { title: 'Client sharing' };

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
  const copy = await loadOwnerCopy(await settingsLocale());
  const t = ownerText(copy);
  return <PageFrame module="settings"><SettingsPage active={SHARING_FEATURE_ID as FeatureId} title={t('Client sharing')} description={t('Give clients limited access to {0} without an account.', viewer.membership.workspace.name)}>
    <SettingsPanel title={t('Share links')} detail={t('Review, calendar and portal links open without signing in, show only the channels you choose, and expire.')}>
      {ready
        ? <LinksManager initial={JSON.parse(JSON.stringify(links))} channels={channels} canApprove={auth.canApprove} limits={{ titleMax: limits.titleMaxCharacters!, descriptionMax: limits.descriptionMaxCharacters!, defaultExpiryDays: limits.defaultExpiryDays!, maxExpiryDays: limits.maxExpiryDays!, maxDaysBack: limits.maxDaysBack!, maxDaysAhead: limits.maxDaysAhead!, maxTargets: limits.maxTargetsPerLink! }} copy={copy} />
        : <p className={styles['settings-note']} role="alert">{t('Share links are unavailable right now.')} <a href="/settings/sharing">{t('Try again')}</a>.</p>}
    </SettingsPanel>
  </SettingsPage></PageFrame>;
}
