"use client";
import { usePublishingCopy } from './kit/CopyProvider';

import type { ChannelGroup } from '@/modules/settings/channel-profiles/contracts';
import { usePathname } from "next/navigation";
import { PostFilters } from "./posts/PostFilters";
import { CalendarFilters } from "./calendar/CalendarFilters";
import { SavedViews } from "./SavedViews";

/** Chooses the sidebar controls for the current publishing page. */
export function PublishingSidebarClient({ groups, locale, channels, today, searchMaxCharacters, exportMaxPosts, exportMaxBytes, origins }: { groups?: ChannelGroup[]; locale?: 'en' | 'fr'; channels: Array<{ id: string; name: string }>; today: string; searchMaxCharacters: number; exportMaxPosts: number; exportMaxBytes: number; origins?: Array<{ kind: string; label: string }> }) {
  const copy = usePublishingCopy(locale);
  const pathname = usePathname();
  return pathname.startsWith("/publishing/collaboration")
    ? <div aria-label={copy.organizationTools}><p className="shell-subnav__label">{copy.organize}</p><p className="help">{copy.organizationHelp}</p></div>
    : pathname === "/publishing/labels"
    ? <div aria-label={copy.labelTools}><p className="shell-subnav__label">{copy.labelsTitle}</p><p className="help">{copy.labelHelp}</p></div>
    : pathname === "/publishing/templates"
    ? <div aria-label={copy.templateTools}><p className="shell-subnav__label">{copy.templatesTitle}</p><p className="help">{copy.templateHelp}</p></div>
    : pathname === "/publishing/calendar"
    ? <><CalendarFilters channels={channels} today={today} /><SavedViews screen="calendar" /></>
    : <><PostFilters groups={groups} locale={locale} channels={channels} currentMonth={today.slice(0, 7)} searchMaxCharacters={searchMaxCharacters} exportMaxPosts={exportMaxPosts} exportMaxBytes={exportMaxBytes} origins={origins} />{pathname === "/publishing/posts" ? <SavedViews screen="posts" /> : null}</>;
}
