"use client";

import { usePathname } from "next/navigation";
import { PostFilters } from "./posts/PostFilters";
import { CalendarFilters } from "./calendar/CalendarFilters";

/** Chooses the sidebar controls for the current publishing page. */
export function PublishingSidebar({ channels, today, searchMaxCharacters, exportMaxPosts, exportMaxBytes }: { channels: Array<{ id: string; name: string }>; today: string; searchMaxCharacters: number; exportMaxPosts: number; exportMaxBytes: number }) {
  const pathname = usePathname();
  return pathname === "/publishing/calendar"
    ? <CalendarFilters channels={channels} today={today} />
    : <PostFilters channels={channels} currentMonth={today.slice(0, 7)} searchMaxCharacters={searchMaxCharacters} exportMaxPosts={exportMaxPosts} exportMaxBytes={exportMaxBytes} />;
}
