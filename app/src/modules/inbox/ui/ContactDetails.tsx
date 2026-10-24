import { resolveInboxCatalog, type InboxCustomerCopy } from '../customer-copy';
import { IconUserOff } from '@tabler/icons-react';
import { ChannelBadge, EmptyState } from '@/components';
import { channelBadgeInfo } from '@/lib/channel-badge';
import type { InboxContactDetails } from '@/modules/inbox/details';
import { PersonAvatar } from './InboxChrome';
import { InboxTag } from './InboxTags';
import type { InboxLocale } from './copy';
import styles from './inbox-round3.module.css';

const TONE = { positive: 'ok', neutral: 'neutral', negative: 'danger' } as const;

/**
 * Side panel for the open conversation: who is writing, how long and how much, which posts they talked about,
 * the labels the team sees, and how their comments read over time. It renders stored facts only; anything the
 * stored data cannot say is shown as unknown rather than as zero or neutral.
 */
export function ContactDetails({ details, locale, timeZone, catalog }: { details: InboxContactDetails | null; locale: InboxLocale; timeZone: string; catalog?: InboxCustomerCopy }) {
  const copy = resolveInboxCatalog('round3Copy', catalog)[locale].details;
  const list = resolveInboxCatalog('inboxCopy', catalog)[locale];
  if (!details) {
    return <aside className={styles.details} aria-label={copy.region}><EmptyState icon={<IconUserOff size={24} />} title={copy.title}>{copy.loadError}</EmptyState></aside>;
  }
  const badge = channelBadgeInfo(details.channel.provider);
  const formatter = new Intl.DateTimeFormat(locale === 'fr' ? 'fr-FR' : 'en-US', { timeZone, year: 'numeric', month: 'short', day: 'numeric' });
  const { sentiment, state } = details;
  const classified = sentiment.counts.positive + sentiment.counts.neutral + sentiment.counts.negative;
  return <aside className={styles.details} aria-label={copy.region}>
    <details open className={styles.detailsBody}><summary className={styles.detailsTitle}>{copy.title}</summary>
    <div className={styles.person}>
      <PersonAvatar name={details.person.name} size={48} />
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <strong>{details.person.name}</strong>
          {details.messageCount >= 5 && (
            <span style={{ fontSize: '10px', fontWeight: 700, padding: '2px 6px', borderRadius: '4px', background: 'var(--brand-instagram, #e1306c)', color: '#fff' }}>
              ⭐ VIP
            </span>
          )}
        </div>
        <div><ChannelBadge name={details.channel.name} platformName={badge.platformName} mark={badge.mark} compact /></div>
      </div>
    </div>
    {!details.identityKnown ? <p className={styles.detailsNote}>{copy.partial}</p> : null}
    <dl className={styles.facts}>
      <div><dt>{copy.firstSeen}</dt><dd>{details.firstSeen ? <time dateTime={details.firstSeen.toISOString()}>{formatter.format(details.firstSeen)}</time> : copy.unknown}</dd></div>
      <div><dt>{copy.messagesWritten}</dt><dd>{details.messageCount}</dd></div>
    </dl>
    <section aria-label={copy.labels}>
      <h4>{copy.labels}</h4>
      <div className={styles.labels}>
        {state.resolved ? <InboxTag icon="resolved" tone="ok">{list.resolvedTag}</InboxTag> : <InboxTag icon="needsReply" tone="warn">{list.openTag}</InboxTag>}
        {state.hidden ? <InboxTag icon="hidden">{list.hidden}</InboxTag> : null}
        {state.unread > 0 ? <InboxTag icon="unread" tone="warn">{copy.unreadLabel(state.unread)}</InboxTag> : null}
        <InboxTag icon="message">{state.assignee ? copy.assignedTo(state.assignee.name || copy.teammate) : copy.unassigned}</InboxTag>
      </div>
    </section>
    <section aria-label={copy.relatedPosts}>
      <h4>{copy.relatedPosts}</h4>
      {details.relatedPosts.length ? <ul className={styles.posts}>
        {details.relatedPosts.map(post => <li key={post.id}>
          <p>{post.text ? (post.text.length > 90 ? `${post.text.slice(0, 90)}…` : post.text) : copy.unknown}</p>
          <span>{copy.commentsOn(post.comments)} · <time dateTime={post.lastCommentAt.toISOString()}>{formatter.format(post.lastCommentAt)}</time></span>
        </li>)}
        {details.relatedPostsMore ? <li className={styles.detailsNote}>{copy.morePosts}</li> : null}
      </ul> : <p className={styles.detailsNote}>{copy.noPosts}</p>}
    </section>
    <section aria-label={copy.sentimentTrend}>
      <h4>{copy.sentimentTrend}</h4>
      {classified === 0 ? <p className={styles.detailsNote}><strong>{copy.noSentiment}</strong> {copy.noSentimentBody}</p> : <>
        <ol className={styles.trend} aria-label={copy.sentimentTrend}>
          {sentiment.points.map((point, index) => <li key={index} data-sentiment={point.sentiment ?? 'unknown'} title={`${formatter.format(point.time)} · ${point.sentiment ? list.sentiment[point.sentiment] : copy.unclassified}`}>
            <span className={styles.srOnly}>{point.sentiment ? list.sentiment[point.sentiment] : copy.unclassified}</span>
          </li>)}
        </ol>
        <p className={styles.detailsNote}>{copy.directions[sentiment.direction]}</p>
        <p className={styles.detailsNote}>{copy.counts(sentiment.counts.positive, sentiment.counts.neutral, sentiment.counts.negative, sentiment.counts.unclassified)}</p>
        <div className={styles.labels}>
          {(['positive', 'neutral', 'negative'] as const).filter(name => sentiment.counts[name] > 0).map(name => <InboxTag key={name} icon={name} tone={TONE[name]} title={list.sentimentHint}>{`${list.sentiment[name]} · ${sentiment.counts[name]}`}</InboxTag>)}
        </div>
      </>}
    </section>
    </details>
  </aside>;
}
