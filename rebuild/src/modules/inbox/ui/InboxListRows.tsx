import { ChannelBadge } from '@/components';
import { channelBadgeInfo } from '@/lib/channel-badge';
import { inboxHref, type InboxLocation } from '../query';
import type { InboxListPage, InboxReadActor } from '../server/types';
import { canManageInbox, canManageInboxWorkflow } from '../server/actions';
import { inboxCapabilities } from '../server/providers';
import { formatInboxTime } from '../server/threads';
import { resolveInboxCatalog, type InboxCustomerCopy } from '../customer-copy';
import { reviewSummary, reviewText } from '../reviews-copy';
import { PersonAvatar } from './InboxChrome';
import { InboxTag, inboxKindTone } from './InboxTags';
import { SelectBox, type SelectableItem } from './InboxSelection';
import type { InboxRow } from './InboxList';
import type { InboxLocale } from './copy';
import styles from './inbox.module.css';
import r3 from './inbox-round3.module.css';

export async function inboxListAbilities(actor: InboxReadActor, page: InboxListPage) {
  const targets = [...new Map(page.items.map(item => [item.target.id, item.target.provider])).entries()];
  const providers = [...new Set(targets.flatMap(([, provider]) => provider ? [provider] : []))];
  const providerCaps = new Map(await Promise.all(providers.map(async provider => [provider, await inboxCapabilities(provider)] as const)));
  return new Map(await Promise.all(targets.map(async ([targetId, provider]) => {
    const [write, resolve] = await Promise.all([canManageInbox(actor, targetId), canManageInboxWorkflow(actor, targetId)]);
    const caps = provider ? providerCaps.get(provider) : undefined;
    return [targetId, { write, resolve, hide: write && Boolean(caps?.hide), remove: write && Boolean(caps?.remove) }] as const;
  })));
}

/** Server-rendered row slots keep time, provider presentation and action grants on the server. */
export function inboxListRows(page: InboxListPage, abilities: Awaited<ReturnType<typeof inboxListAbilities>>, baseLocation: InboxLocation, selectedThread: string | undefined, locale: InboxLocale, catalog: InboxCustomerCopy, previewMaxCharacters: number, canOpenPosts = false): InboxRow[] {
  const copy = resolveInboxCatalog('inboxCopy', catalog)[locale];
  const extra = resolveInboxCatalog('round3Copy', catalog)[locale];
  const reviews = resolveInboxCatalog('reviewCopy', catalog);
  const reviewLabel = (language: Parameters<typeof reviewText>[0], key: Parameters<typeof reviewText>[1]) => reviewText(language, key, undefined, reviews);
  const timeZone = page.timeZone;
  const SENTIMENT_TONE = { positive: 'ok', neutral: 'neutral', negative: 'danger' } as const;
  const selectables = new Map<string, SelectableItem>();
  for (const item of page.items) {
    const ability = abilities.get(item.target.id);
    if (!ability) continue;
    // Assignment needs the same local write grant as resolve, on an item kind that carries an assignee.
    const can = { resolve: ability.resolve, hide: item.kind === 'comment' && ability.hide, remove: item.kind === 'comment' && ability.remove, assign: (item.kind === 'message' || item.kind === 'comment') && ability.resolve };
    if (can.resolve || can.hide || can.remove || can.assign) selectables.set(item.key, { key: item.key, kind: item.kind, id: item.id, label: item.author, platformName: channelBadgeInfo(item.target.provider).platformName, resolved: item.resolved, hidden: item.hidden, can });
  }
  const hasSelection = selectables.size > 0;
  return page.items.map(item => {
    const badge = channelBadgeInfo(item.target.provider);
    const selected = selectedThread === item.key;
    const selectable = selectables.get(item.key);
    const body = item.preview.trim() ? (item.preview.length > previewMaxCharacters ? `${item.preview.slice(0, previewMaxCharacters)}…` : item.preview) : item.kind === 'comment' ? copy.commentNoText : item.kind === 'review' ? reviewLabel(locale, 'noText') : item.preview;
    const content = <li key={item.key} className={hasSelection ? r3.row : undefined}>{hasSelection ? <span className={r3.rowSelect}>{selectable ? <SelectBox item={selectable} label={extra.bulk.selectItem(item.author)} /> : null}</span> : null}<a className={styles.item} href={inboxHref({ ...baseLocation, ...(page.cursor ? { cursor: page.cursor } : {}), thread: item.key })} aria-current={selected ? 'true' : undefined} data-attention={item.needsReply || item.unread > 0 || undefined} data-group={item.kind} data-inbox-item>
      <PersonAvatar name={item.author} size={38} />
      <div className={styles.itemBody}>
      <div className={styles.itemTop}><span className={styles.author}>{item.unread > 0 || item.needsReply ? <span className={styles.unreadDot} role="img" aria-label={copy.unread} /> : null}{item.author}</span><time dateTime={item.time.toISOString()}>{formatInboxTime(item.time, timeZone, false, locale)}</time></div>
      <p className={styles.preview}>{body}</p>
      {item.kind === 'comment' && item.context ? <p className={styles.postContext}><strong>{copy.onYourPost}</strong>{item.context.length > 160 ? `${item.context.slice(0, 160)}…` : item.context}</p> : null}
      <div className={styles.itemMeta}>
        <ChannelBadge name={item.target.name} platformName={badge.platformName} mark={badge.mark} compact />
        <InboxTag icon={item.kind === 'message' ? 'message' : item.kind === 'review' ? 'review' : 'comment'} tone={inboxKindTone(item.kind)}>{item.kind === 'message' ? copy.message : item.kind === 'review' ? reviewLabel(locale, 'review') : copy.comment}</InboxTag>
        {item.kind === 'review' ? <InboxTag icon="review">{reviewSummary(locale, item, reviews)}</InboxTag> : null}
        {item.sentiment ? <InboxTag icon={item.sentiment} tone={SENTIMENT_TONE[item.sentiment]} title={copy.sentimentHint}>{copy.sentiment[item.sentiment]}</InboxTag> : null}
        {item.unread > 0 ? <InboxTag icon="unread" tone="warn">{copy.nUnread(item.unread)}</InboxTag> : null}
        {item.needsReply ? <InboxTag icon="needsReply" tone="warn">{copy.needsReply}</InboxTag> : null}
        {item.resolved ? <InboxTag icon="resolved" tone="ok">{copy.resolvedTag}</InboxTag> : null}
        {item.hidden ? <InboxTag icon="hidden">{copy.hidden}</InboxTag> : null}
      </div>
      </div>
    </a>{item.kind === 'comment' && item.postId && canOpenPosts ? <a className={hasSelection ? `${styles.postOpen} ${r3.postOpen}` : styles.postOpen} href={`/content/post/${encodeURIComponent(item.postId)}`}>{copy.openPost}</a> : null}</li>;

    return { key: item.key, content, selectable: selectable ?? null };
  });
}
