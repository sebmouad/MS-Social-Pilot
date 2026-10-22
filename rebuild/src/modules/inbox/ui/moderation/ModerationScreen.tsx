import { loadInboxCustomerCopy } from '@/modules/inbox/server/customer-copy';
import { resolveInboxCatalog } from '@/modules/inbox/customer-copy';
import { InboxCopyProvider } from '@/modules/inbox/ui/copy-context';
import { InfoTip, LinkTabs } from '@/components';
import { PageFrame } from '@/server/PageFrame';
import { requireViewer } from '@/server/context';
import { canAccessFeature } from '@/server/permissions';
import { shellChrome } from '@/modules/shell/server/chrome';
import { ModerationRules } from '@/modules/inbox/components/ModerationRules';
import styles from '@/modules/inbox/ui/inbox.module.css';
import { InboxHeader } from '@/modules/inbox/ui/InboxChrome';
import { inboxLocale } from '@/modules/inbox/ui/locale';

/** Inbox › Rules (design v2 S8): the second Inbox tab; the rules themselves are unchanged. */
export default async function InboxRulesPage() {
  const viewer = await requireViewer({ feature: 'inbox/conversations', channelScoped: true });
  const canWrite = canAccessFeature(viewer.permissions, 'inbox/conversations', 'write');
  const locale = await inboxLocale();
  const catalog = await loadInboxCustomerCopy();
  const copy = resolveInboxCatalog('inboxCopy', catalog)[locale];
  const moderation = resolveInboxCatalog('moderationCopy', catalog)[locale];
  const screen = resolveInboxCatalog('round3Copy', catalog)[locale].screen;
  const { copy: shell } = await shellChrome();
  const tabs = <LinkTabs label={screen.tabsLabel} moreLabel={shell.moreTabs} activeId="rules"
    items={[{ id: 'conversations', href: '/inbox', label: screen.tabConversations }, { id: 'rules', href: '/inbox/rules', label: screen.tabRules }]} />;
  return <InboxCopyProvider catalog={catalog}><PageFrame module="inbox" scopedAccess><div className={styles.page}>
    <InboxHeader title={copy.title} info={<InfoTip name={moderation.title}>{moderation.pageIntro}</InfoTip>} tabs={tabs} />
    <ModerationRules locale={locale} canWrite={canWrite} />
  </div></PageFrame></InboxCopyProvider>;
}
