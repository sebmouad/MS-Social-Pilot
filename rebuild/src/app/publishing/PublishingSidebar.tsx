"use client";

import { usePathname } from "next/navigation";
import { PostFilters } from "./posts/PostFilters";
import { CalendarFilters } from "./calendar/CalendarFilters";

/** Chooses the sidebar controls for the current publishing page. */
export function PublishingSidebar({ channels, today, searchMaxCharacters, exportMaxPosts, exportMaxBytes }: { channels: Array<{ id: string; name: string }>; today: string; searchMaxCharacters: number; exportMaxPosts: number; exportMaxBytes: number }) {
  const pathname = usePathname();
  return pathname === "/publishing/labels"
    ? <div aria-label="Label tools"><p className="shell-subnav__label">Labels</p><p className="help">Organize and manage workspace content labels.</p></div>
    : pathname === "/publishing/templates"
    ? <div aria-label="Template tools"><p className="shell-subnav__label">Templates</p><p className="help">Search workspace templates or create a reusable post message from here.</p></div>
    : pathname === "/publishing/calendar"
    ? <CalendarFilters channels={channels} today={today} />
    : <PostFilters channels={channels} currentMonth={today.slice(0, 7)} searchMaxCharacters={searchMaxCharacters} exportMaxPosts={exportMaxPosts} exportMaxBytes={exportMaxBytes} />;
}
