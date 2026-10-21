import type { Metadata } from 'next';
import { PageFrame } from '@/server/PageFrame';
import { requireViewer } from '@/server/context';
import { readBioPage } from '@/modules/sharing/server/bio';
import { loadOwnerCopy, sharingLimits } from '@/modules/sharing/server/limits';
import { ownerText } from '@/modules/sharing/ui/owner-copy';
import { settingsLocale } from '@/modules/settings/ui/locale';
import { BIO_FEATURE_ID } from '@/modules/sharing/semantics';
import type { FeatureId } from '@/lib/product';
import { SettingsPage, SettingsPanel, styles } from '@/modules/settings/ui/_components';
import { BioManager } from './BioManager';

export async function generateMetadata(): Promise<Metadata> {
  return { title: ownerText(await loadOwnerCopy(await settingsLocale()))('Bio page') };
}

export default async function BioSettingsPage() {
  const viewer = await requireViewer({ feature: BIO_FEATURE_ID });
  const actor = { userId: viewer.user.id, workspaceId: viewer.workspaceId };
  const [bio, limits] = await Promise.all([readBioPage(actor).catch(() => null), sharingLimits().catch(() => null)]);
  const copy = await loadOwnerCopy(await settingsLocale());
  const t = ownerText(copy);
  return <PageFrame module="settings"><SettingsPage active={BIO_FEATURE_ID as FeatureId} title={t('Bio page')} description={t('One public page with your links for {0}. Clicks are counted without storing visitor details.', viewer.membership.workspace.name)}>
    <SettingsPanel title={t('Public page')} detail={t('Visitors need no account. Only the address, title, picture and link labels are shown; link addresses open through a counted redirect.')}>
      {bio && limits
        ? <BioManager initial={JSON.parse(JSON.stringify(bio))} limits={{ titleMax: limits.bio_titleMaxCharacters!, descriptionMax: limits.bio_descriptionMaxCharacters!, labelMax: limits.bio_linkLabelMaxCharacters!, urlMax: limits.bio_urlMaxCharacters! }} copy={copy} />
        : <p className={styles['settings-note']} role="alert">{t('The bio page is unavailable right now.')} <a href="/settings/bio">{t('Try again')}</a>.</p>}
    </SettingsPanel>
  </SettingsPage></PageFrame>;
}
