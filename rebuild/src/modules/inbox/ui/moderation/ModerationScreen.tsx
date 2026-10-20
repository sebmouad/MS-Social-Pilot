import { PageFrame } from '@/server/PageFrame';
import { requireViewer } from '@/server/context';
import { canAccessFeature } from '@/server/permissions';
import { ModerationRules } from '@/modules/inbox/components/ModerationRules';
import { moderationText } from '@/modules/inbox/moderation';
import styles from '@/modules/inbox/ui/inbox.module.css';
import { InboxHeader } from '@/modules/inbox/ui/InboxChrome';


export default async function InboxModerationPage() {
  const viewer = await requireViewer({ feature: 'inbox/conversations', channelScoped: true });
  const canWrite = canAccessFeature(viewer.permissions, 'inbox/conversations', 'write');
  const sidebar = <aside className={styles.filters} aria-label="Inbox navigation">
    <div className={styles.navigationGroup}>
      <p className={styles.filterHeading}>Inbox</p>
      <a href="/inbox">Conversations</a>
      <a href="/inbox/moderation" aria-current="page">{moderationText('en', 'title')}</a>
    </div>
  </aside>;
  return <PageFrame module="inbox" scopedAccess sidebar={sidebar}><div className={styles.page}>
    <InboxHeader href="/inbox" eyebrow="Inbox" title={moderationText('en', 'title')} description={moderationText('en', 'pageIntro')} actions={<a className="ui-button ui-button--secondary" href="/inbox">Conversations</a>} />
    <ModerationRules canWrite={canWrite} />
  </div></PageFrame>;
}
