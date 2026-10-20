import type { ReactNode } from 'react';
import { IconAlertTriangle, IconClockHour4, IconPlayerPlay, IconSend, IconX } from '@tabler/icons-react';
import { ModuleGlyph, PageGlyph } from '@/components/icons';
import { kitCopy, type KitLocale } from './copy';
import styles from './kit.module.css';

/**
 * Module-local UI primitives. TODO: swap to the shared PageHeader, Avatar, chip and
 * empty-state components once the shared set lands; props are kept compatible.
 */
export function initials(value: string) {
  return value.trim().split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]?.toUpperCase()).join('') || '?';
}

/** Hash a name to one of the eight chart tokens so a channel keeps the same colour everywhere. */
export function channelHue(key: string) {
  let hash = 0;
  for (const char of key) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return `var(--chart-${(hash % 8) + 1})`;
}

export function isSafeImageUrl(value: string | null | undefined) {
  if (!value) return false;
  try { const url = new URL(value); return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password; } catch { return false; }
}

export function Avatar({ name, src, size = 28 }: { name: string; src?: string | null; size?: number }) {
  const style = { width: size, height: size, ['--avatar-hue' as string]: channelHue(name) };
  return isSafeImageUrl(src)
    // eslint-disable-next-line @next/next/no-img-element
    ? <img className={styles.avatar} style={style} src={src!} alt="" loading="lazy" />
    : <span className={styles.avatar} data-fallback style={style} aria-hidden="true">{initials(name)}</span>;
}

/** Overlapping channel avatars with a names tooltip and a "+n" counter. */
export function AvatarStack({ channels, max = 4, locale = 'en' }: { channels: Array<{ id: string; name: string; pictureUrl?: string | null }>; max?: number; locale?: KitLocale }) {
  const copy = kitCopy[locale];
  if (!channels.length) return <span className={styles.muted}>{copy.noDestinations}</span>;
  const shown = channels.slice(0, max);
  const extra = channels.length - shown.length;
  return <span className={styles.stack} title={channels.map(channel => channel.name).join(', ')}>
    {shown.map(channel => <Avatar key={channel.id} name={channel.name} src={channel.pictureUrl} size={26} />)}
    {extra > 0 ? <span className={styles.stackMore}>+{extra}</span> : null}
    <span className={styles.stackNames}>{shown.map(channel => channel.name).join(', ')}{extra > 0 ? ` +${extra} ${copy.moreDestinations}` : ''}</span>
  </span>;
}

/** Page header with the module icon chip. Colours come from the [data-module] tokens. */
export function ModuleHeader({ module = 'publishing', href, eyebrow, title, description, summary, actions }: { module?: string; href?: string; eyebrow?: string; title: string; description?: string; summary?: ReactNode; actions?: ReactNode }) {
  return <header className={styles.header} data-module={module}>
    <span className={styles.chip}>{href ? <PageGlyph href={href} size={22} /> : <ModuleGlyph id={module} size={22} />}</span>
    <div className={styles.headerText}>
      {eyebrow ? <p className={styles.eyebrow}>{eyebrow}</p> : null}
      <h1>{title}</h1>
      {description ? <p className={styles.description}>{description}</p> : null}
    </div>
    {summary || actions ? <div className={styles.headerSide}>{summary ? <span className={styles.summary}>{summary}</span> : null}{actions}</div> : null}
  </header>;
}

/** Empty or no-match state with an icon and one clear next action. */
export function EmptyPanel({ module = 'publishing', icon, title, children, action }: { module?: string; icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return <div className={styles.empty} data-module={module}>
    <span className={styles.emptyIcon}>{icon ?? <ModuleGlyph id={module} size={26} />}</span>
    <h2>{title}</h2>
    {children ? <p>{children}</p> : null}
    {action}
  </div>;
}

/** Who sends the post at the scheduled time: this app, or the platform itself. */
export function ScheduleBadge({ mode, locale = 'en', platformName }: { mode: 'application' | 'remote'; locale?: KitLocale; platformName?: string }) {
  const copy = kitCopy[locale];
  const remote = mode === 'remote';
  // The platform's own name comes from its module metadata; shared code never names a provider.
  return <span className={styles.schedule} data-mode={mode} title={remote ? copy.scheduledRemoteHint : copy.scheduledAppHint}>
    {remote ? <IconClockHour4 size={12} stroke={1.9} aria-hidden="true" /> : <IconSend size={12} stroke={1.9} aria-hidden="true" />}
    <span>{remote ? platformName || copy.scheduledPlatform : copy.scheduledApp}</span>
    <span className="ui-visually-hidden"> — {remote ? copy.scheduledRemoteHint : copy.scheduledAppHint}</span>
  </span>;
}

export function AttentionHint({ locale = 'en' }: { locale?: KitLocale }) {
  return <span className={styles.attention}><IconAlertTriangle size={12} stroke={1.9} aria-hidden="true" />{kitCopy[locale].needsAttention}</span>;
}

export function MediaThumb({ url, alt, count, video }: { url: string | null; alt: string; count: number; video?: boolean }) {
  return <span className={styles.thumb} data-empty={!url || undefined}>
    {url && !video
      // eslint-disable-next-line @next/next/no-img-element
      ? <img src={url} alt={alt} loading="lazy" />
      : video ? <IconPlayerPlay size={18} stroke={1.8} aria-hidden="true" /> : null}
    {count > 1 ? <span className={styles.thumbCount}>+{count - 1}</span> : null}
  </span>;
}

export type FilterChip = { key: string; label: string; value: string; removeHref: string };

/** Active filters as removable chips; each removal is a plain link so it works without script. */
export function FilterChips({ chips, resetHref, locale = 'en' }: { chips: FilterChip[]; resetHref: string; locale?: KitLocale }) {
  if (!chips.length) return <span />;
  const copy = kitCopy[locale];
  return <ul className={styles.chips} aria-label={copy.activeFilters}>
    {chips.map(chip => <li key={chip.key}>
      <a className={styles.filterChip} href={chip.removeHref} aria-label={`${copy.removeFilter}: ${chip.label} ${chip.value}`}>
        <span className={styles.filterKey}>{chip.label}</span><span>{chip.value}</span><IconX size={12} stroke={2} aria-hidden="true" />
      </a>
    </li>)}
    <li><a className={styles.resetLink} href={resetHref}>{copy.resetFilters}</a></li>
  </ul>;
}
