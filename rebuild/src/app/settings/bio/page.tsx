import type { Metadata } from 'next';
import { PageFrame } from '@/server/PageFrame';
import { requireViewer } from '@/server/context';
import { readBioPage } from '@/modules/sharing/server/bio';
import { sharingLimits } from '@/modules/sharing/server/limits';
import { BIO_FEATURE_ID } from '@/modules/sharing/semantics';
import type { FeatureId } from '@/lib/product';
import { SettingsPage, SettingsPanel, styles } from '../_components';
import { BioManager } from './BioManager';

export const metadata: Metadata = { title: 'Bio page' };
export const dynamic = 'force-dynamic';

export default async function BioSettingsPage() {
  const viewer = await requireViewer({ feature: BIO_FEATURE_ID });
  const actor = { userId: viewer.user.id, workspaceId: viewer.workspaceId };
  const [bio, limits] = await Promise.all([readBioPage(actor).catch(() => null), sharingLimits().catch(() => null)]);
  return <PageFrame module="settings"><SettingsPage active={BIO_FEATURE_ID as FeatureId} title="Bio page" description={`One public page with your links for ${viewer.membership.workspace.name}. Clicks are counted without storing visitor details.`}>
    <SettingsPanel title="Public page" detail="Visitors need no account. Only the address, title, picture and link labels are shown; link addresses open through a counted redirect.">
      {bio && limits
        ? <BioManager initial={JSON.parse(JSON.stringify(bio))} limits={{ titleMax: limits.bio_titleMaxCharacters!, descriptionMax: limits.bio_descriptionMaxCharacters!, labelMax: limits.bio_linkLabelMaxCharacters!, urlMax: limits.bio_urlMaxCharacters! }} />
        : <p className={styles['settings-note']} role="alert">The bio page is unavailable right now. <a href="/settings/bio">Try again</a>.</p>}
    </SettingsPanel>
  </SettingsPage></PageFrame>;
}
