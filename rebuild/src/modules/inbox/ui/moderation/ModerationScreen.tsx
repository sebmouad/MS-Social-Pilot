import { PageFrame } from '@/server/PageFrame';
import { requireViewer } from '@/server/context';
import { canAccessFeature } from '@/server/permissions';
import { ModerationRules } from '@/modules/inbox/components/ModerationRules';
import { moderationText } from '@/modules/inbox/moderation';
import styles from '@/modules/inbox/ui/inbox.module.css';
import { InboxHeader } from '@/modules/inbox/ui/InboxChrome';
import { inboxCopy } from '@/modules/inbox/ui/copy';
import { inboxLocale } from '@/modules/inbox/ui/locale';

export default async function InboxModerationPage() {
  const viewer = await requireViewer({ feature: 'inbox/conversations', channelScoped: true });
  const canWrite = canAccessFeature(viewer.permissions, 'inbox/conversations', 'write');
  const locale = await inboxLocale();
  const copy = inboxCopy[locale];
  const sidebar = <aside className={styles.filters} aria-label={copy.eyebrow}>
    <div className={styles.navigationGroup}>
      <p className={styles.filterHeading}>{copy.eyebrow}</p>
      <a href="/inbox">{copy.conversations}</a>
      <a href="/inbox/moderation" aria-current="page">{moderationText(locale, 'title')}</a>
    </div>
  </aside>;
  return <PageFrame module="inbox" scopedAccess sidebar={sidebar}><div className={styles.page}>
    <InboxHeader href="/inbox" eyebrow={copy.eyebrow} title={moderationText(locale, 'title')} description={moderationText(locale, 'pageIntro')} actions={<a className="ui-button ui-button--secondary" href="/inbox">{copy.conversations}</a>} />
    <ModerationRules canWrite={canWrite} />
  </div></PageFrame>;
}
