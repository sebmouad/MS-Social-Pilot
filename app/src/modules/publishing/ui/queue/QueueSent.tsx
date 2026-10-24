import styles from './queue.module.css';

export type QueueSentCopy = { title: string; body: string; reviewSent: string; reviewFailed: string };

/**
 * The "Sent" block under Content › Queue: the queue holds what is still to go
 * out, while sent and failed posts stay under Posts. Rendered only when at
 * least one sent or failed post exists in the current channel scope.
 */
export function QueueSent({ copy, published, failed, sentHref, failedHref }: {
  copy: QueueSentCopy; published: number; failed: number; sentHref: string; failedHref: string;
}) {
  if (published <= 0 && failed <= 0) return null;
  return <section className={styles.sent} aria-labelledby="queue-sent">
    <h2 id="queue-sent">{copy.title}</h2>
    <p>{copy.body}</p>
    <ul>
      {published > 0 ? <li><a href={sentHref}>{copy.reviewSent}</a></li> : null}
      {failed > 0 ? <li><a href={failedHref}>{copy.reviewFailed}</a></li> : null}
    </ul>
  </section>;
}
