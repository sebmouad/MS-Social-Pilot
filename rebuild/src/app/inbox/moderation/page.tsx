import { PageFrame } from '@/server/PageFrame';
import { requireViewer } from '@/server/context';
import { canAccessFeature } from '@/server/permissions';
import { ModerationRules } from '@/modules/inbox/components/ModerationRules';
import { moderationText } from '@/modules/inbox/moderation';
import styles from '../inbox.module.css';

export const dynamic = 'force-dynamic';

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
    <header className={styles.head}><div><p className="eyebrow">Inbox</p><h1>{moderationText('en', 'title')}</h1><p>{moderationText('en', 'pageIntro')}</p></div></header>
    <ModerationRules canWrite={canWrite} />
  </div></PageFrame>;
}
