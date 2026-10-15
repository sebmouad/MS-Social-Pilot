import type { ReactNode } from "react";
import { ChannelBadge } from "@/components";
import { channelBadgeInfo } from "@/lib/channel-badge";
import styles from "./worklist.module.css";

type RowTarget = { target: { id: string; name: string } };

/** Channel badges for a post row; the provider of each channel comes from the connected-channel list. */
export function RowChannels({ targets, providers }: { targets: RowTarget[]; providers: ReadonlyMap<string, string | null> }) {
  const unique = [...new Map(targets.map(({ target }) => [target.id, target])).values()];
  if (!unique.length) return <span className={styles.muted}>No channels chosen</span>;
  return <ul className={styles.channels} aria-label="Channels">{unique.map(target => {
    const info = channelBadgeInfo(providers.get(target.id));
    return <li key={target.id}><ChannelBadge name={target.name} platformName={info.platformName} mark={info.mark} /></li>;
  })}</ul>;
}

export function WorkRow({ chip, when, children, actions }: { chip: ReactNode; when: ReactNode; children: ReactNode; actions?: ReactNode }) {
  return <li className={styles.row}>
    <div className={styles.rowMain}>
      <div className={styles.rowTop}>{chip}<span className={styles.when}>{when}</span></div>
      {children}
    </div>
    {actions ? <div className={styles.rowActions}>{actions}</div> : null}
  </li>;
}

export function WorkList({ label, children }: { label: string; children: ReactNode }) {
  return <ul className={styles.list} aria-label={label}>{children}</ul>;
}

export function EmptyState({ title, children }: { title: string; children: ReactNode }) {
  return <div className={styles.empty}><h2>{title}</h2><p>{children}</p></div>;
}

export { styles as workStyles };
