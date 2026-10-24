'use client';
import { usePublishingCopy } from './CopyProvider';
import { useState, type ReactNode } from 'react';
import { IconAlertTriangle, IconClockHour4, IconPhotoOff, IconPlayerPlay, IconSend } from '@tabler/icons-react';
import { Badge, EmptyState, PageHeader } from '@/components';
import { ModuleGlyph, PageGlyph } from '@/components/icons';
import { type KitLocale } from './copy';
import styles from './kit.module.css';

/**
 * Publishing display helpers built on the shared component library (PageHeader, EmptyState,
 * Badge). Only domain-specific pieces live here: channel avatars, media thumbnails and the
 * schedule-owner badge.
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
  const copy = usePublishingCopy(locale);
  if (!channels.length) return <span className={styles.muted}>{copy.noDestinations}</span>;
  const shown = channels.slice(0, max);
  const extra = channels.length - shown.length;
  return <span className={styles.stack} title={channels.map(channel => channel.name).join(', ')}>
    {shown.map(channel => <Avatar key={channel.id} name={channel.name} src={channel.pictureUrl} size={26} />)}
    {extra > 0 ? <span className={styles.stackMore}>+{extra}</span> : null}
    <span className={styles.stackNames}>{shown.map(channel => channel.name).join(', ')}{extra > 0 ? ` +${extra} ${copy.moreDestinations}` : ''}</span>
  </span>;
}

/** Page header: the shared PageHeader with the module icon chip; the optional summary is a badge beside the actions. */
export function ModuleHeader({ module = 'publishing', href, title, description, summary, actions }: { module?: string; href?: string; eyebrow?: string; title: string; description?: string; summary?: ReactNode; actions?: ReactNode }) {
  const side = summary || actions ? <>{summary ? <Badge tone="neutral">{summary}</Badge> : null}{actions}</> : undefined;
  return <PageHeader module={module} icon={href ? <PageGlyph href={href} size={22} /> : undefined} title={title} description={description} actions={side} />;
}

/** Empty or no-match state with an icon and one clear next action. */
export function EmptyPanel({ module = 'publishing', icon, title, children, action }: { module?: string; icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return <div data-module={module}><EmptyState icon={icon ?? <ModuleGlyph id={module} size={26} />} title={title} action={action}>{children}</EmptyState></div>;
}

/** Who sends the post at the scheduled time: this app, or the platform itself. */
export function ScheduleBadge({ mode, locale = 'en', platformName }: { mode: 'application' | 'remote'; locale?: KitLocale; platformName?: string }) {
  const copy = usePublishingCopy(locale);
  const remote = mode === 'remote';
  // The platform's own name comes from its module metadata; shared code never names a provider.
  return <span className={styles.schedule} title={remote ? copy.scheduledRemoteHint : copy.scheduledAppHint}>
    <Badge tone={remote ? 'brand' : 'neutral'} icon={remote ? <IconClockHour4 size={12} stroke={1.9} /> : <IconSend size={12} stroke={1.9} />}>{remote ? platformName || copy.scheduledPlatform : copy.scheduledApp}</Badge>
    <span className="ui-visually-hidden"> — {remote ? copy.scheduledRemoteHint : copy.scheduledAppHint}</span>
  </span>;
}

export function AttentionHint({ locale = 'en' }: { locale?: KitLocale }) {
  const copy = usePublishingCopy(locale);
  return <span className={styles.attention}><IconAlertTriangle size={12} stroke={1.9} aria-hidden="true" />{copy.needsAttention}</span>;
}

/**
 * Post image that degrades to a neutral placeholder when the file is gone (for example a 404 from
 * the media route). The failure is recorded once per source, so there is no retry loop and no
 * further requests; the placeholder carries the accessible text instead of a broken-image icon.
 */
export function PostImage({ src, alt, locale, className, linkClassName, href, iconSize = 20 }: { src: string; alt: string; locale?: KitLocale; className?: string; linkClassName?: string; href?: string; iconSize?: number }) {
  const copy = usePublishingCopy(locale);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  if (failedSrc === src) {
    return <span className={styles.mediaMissing} role="img" aria-label={copy.mediaUnavailable} data-media-missing><IconPhotoOff size={iconSize} stroke={1.7} aria-hidden="true" /></span>;
  }
  // eslint-disable-next-line @next/next/no-img-element
  const image = <img className={className} src={src} alt={alt} loading="lazy" onError={() => setFailedSrc(src)} />;
  return href ? <a className={linkClassName} href={href} target="_blank" rel="noopener noreferrer" aria-label={copy.openImageAttachment}>{image}</a> : image;
}

export function MediaThumb({ url, alt, count, video, locale }: { url: string | null; alt: string; count: number; video?: boolean; locale?: KitLocale }) {
  return <span className={styles.thumb} data-empty={!url || undefined}>
    {url && !video
      ? <PostImage src={url} alt={alt} locale={locale} iconSize={18} />
      : video ? <IconPlayerPlay size={18} stroke={1.8} aria-hidden="true" /> : null}
    {count > 1 ? <span className={styles.thumbCount}>+{count - 1}</span> : null}
  </span>;
}

export { UrlFilterChips as FilterChips } from './UrlFilterChips';
export type { UrlFilterChip as FilterChip } from './UrlFilterChips';
