import { loadInboxCustomerCopy } from '@/modules/inbox/server/customer-copy';
import { resolveInboxCatalog } from '@/modules/inbox/customer-copy';
import { InboxCopyProvider } from '@/modules/inbox/ui/copy-context';
import { PageFrame } from '@/server/PageFrame';
import { requireViewer } from '@/server/context';
import { canAccessFeature } from '@/server/permissions';
import { ModerationRules } from '@/modules/inbox/components/ModerationRules';
import styles from '@/modules/inbox/ui/inbox.module.css';
import { InboxHeader } from '@/modules/inbox/ui/InboxChrome';
import { inboxLocale } from '@/modules/inbox/ui/locale';

export default async function InboxModerationPage() {
  const viewer = await requireViewer({ feature: 'inbox/conversations', channelScoped: true });
  const canWrite = canAccessFeature(viewer.permissions, 'inbox/conversations', 'write');
  const locale = await inboxLocale();
  const catalog = await loadInboxCustomerCopy();
  const copy = resolveInboxCatalog('inboxCopy', catalog)[locale];
  const moderation = resolveInboxCatalog('moderationCopy', catalog)[locale];
  const sidebar = <aside className={styles.filters} aria-label={copy.eyebrow}>
    <div className={styles.navigationGroup}>
      <p className={styles.filterHeading}>{copy.eyebrow}</p>
      <a href="/inbox">{copy.conversations}</a>
      <a href="/inbox/moderation" aria-current="page">{moderation.title}</a>
    </div>
  </aside>;
  return <InboxCopyProvider catalog={catalog}><PageFrame module="inbox" scopedAccess sidebar={sidebar}><div className={styles.page}>
    <InboxHeader href="/inbox" eyebrow={copy.eyebrow} title={moderation.title} description={moderation.pageIntro} actions={<a className="ui-button ui-button--secondary" href="/inbox">{copy.conversations}</a>} />
    <ModerationRules locale={locale} canWrite={canWrite} />
  </div></PageFrame></InboxCopyProvider>;
}
