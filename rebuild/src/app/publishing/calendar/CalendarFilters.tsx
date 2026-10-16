"use client";

import { useSearchParams } from "next/navigation";
import styles from "../publishing.module.css";
import { FieldError, useFormValidation } from '@/components/FormValidation';

const STATUS_CHOICES = [
  ["draft", "Draft"], ["pending_approval", "Pending approval"], ["rejected", "Rejected"], ["scheduled", "Scheduled"],
  ["publishing", "Publishing"], ["published", "Published"], ["partially_failed", "Partly failed"], ["failed", "Failed"], ["cancelled", "Cancelled"],
] as const;

/** Calendar view, date, channel and status filters for the sidebar. */
export function CalendarFilters({ channels, today }: { channels: Array<{ id: string; name: string }>; today: string }) {
  const validation = useFormValidation();
  const params = useSearchParams();
  const month = params.get("month");
  const date = params.get("date") ?? (month ? `${month}-01` : today);
  return <form noValidate action="/publishing/calendar" method="get" className={styles.postFilters} key={params.toString()} onSubmit={event => { if (!validation.validate(event.currentTarget)) event.preventDefault(); }}>
    <p className="shell-subnav__label">Calendar</p>
    <label htmlFor="calendar-view-filter">View</label>
    <select id="calendar-view-filter" name="view" defaultValue={params.get("view") === "week" ? "week" : "month"}>
      <option value="month">Month</option>
      <option value="week">Week</option>
    </select>
    <label htmlFor="calendar-date-filter">Go to date</label>
    <input id="calendar-date-filter" type="date" name="date" defaultValue={date} required aria-invalid={validation.fieldProps('date')['aria-invalid']} aria-describedby={validation.fieldProps('date')['aria-describedby']} />
    <FieldError {...validation.errorProps('date')} />
    <label htmlFor="calendar-channel-filter">Channel</label>
    <select id="calendar-channel-filter" name="channel" defaultValue={params.get("channel") ?? ""}>
      <option value="">All accessible channels</option>
      {channels.map(channel => <option value={channel.id} key={channel.id}>{channel.name}</option>)}
    </select>
    <label htmlFor="calendar-status-filter">Status</label>
    <select id="calendar-status-filter" name="status" defaultValue={params.get("status") ?? ""}>
      <option value="">All statuses</option>
      {STATUS_CHOICES.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
    </select>
    <button type="submit">Apply</button>
    <a href="/publishing/calendar">Reset</a>
  </form>;
}
