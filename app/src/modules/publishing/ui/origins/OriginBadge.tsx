import { IconExternalLink, IconToolsKitchen2 } from '@tabler/icons-react';
import { Badge } from '@/components';
import type { PostOriginView } from './post-origin';
import styles from './origin.module.css';

/** Marks a post made by an automation: a module-colored badge, the source name and a link to the original article. */
export function OriginBadge({ origin, compact = false }: { origin: PostOriginView; compact?: boolean }) {
  return <span className={styles.origin} data-compact={compact || undefined}>
    <Badge tone="module" module="publishing" icon={<IconToolsKitchen2 size={12} stroke={1.9} />}>{origin.label}</Badge>
    {compact ? null : <span className={styles.source}>{origin.sourceName}</span>}
    {origin.url ? <a className={styles.link} href={origin.url} target="_blank" rel="noopener noreferrer" aria-label={`${origin.linkLabel} — ${origin.sourceName}`} title={origin.sourceName}>
      <span>{origin.linkLabel}</span><IconExternalLink size={12} aria-hidden="true" />
    </a> : null}
  </span>;
}
