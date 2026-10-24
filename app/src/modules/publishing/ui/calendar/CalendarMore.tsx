'use client';
import { IconCalendarEvent } from '@tabler/icons-react';
import { useRouter } from 'next/navigation';
import { Menu } from '@/components';
import { useContent } from '../ContentProvider';

/** Key dates, seasons, holidays and calendar subscriptions: the calendar's other screens, offered from its header. */
export function CalendarMore({ links }: { links: Array<{ href: string; label: string }> }) {
  const router = useRouter();
  const { copy } = useContent();
  if (!links.length) return null;
  return <Menu label={copy.calendarMoreCalendars} trigger={<><IconCalendarEvent size={16} aria-hidden="true" /><span>{copy.calendarMoreCalendars}</span></>}
    items={links.map(link => ({ key: link.href, label: link.label, onSelect: () => router.push(link.href) }))} />;
}
