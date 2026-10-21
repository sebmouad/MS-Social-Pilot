"use client";
import { usePublishingCopy } from '../kit/CopyProvider';
import { originCopy } from '../origins/copy';

import { useSearchParams } from "next/navigation";
import { PublishingChannelOptions } from '@/modules/publishing/ui/PublishingChannelOptions';
import styles from "@/modules/publishing/ui/publishing.module.css";
import { FieldError, useFormValidation } from '@/components/FormValidation';

const STATUS_CHOICES = [
  "draft", "pending_approval", "rejected", "scheduled",
  "publishing", "published", "partially_failed", "failed", "cancelled",
] as const;

/** Calendar view, date, channel and status filters for the sidebar. */
export function CalendarFilters({ channels, today, origins = [], locale = "en" }: { channels: Array<{ id: string; name: string }>; today: string; origins?: Array<{ kind: string; label: string }>; locale?: "en" | "fr" }) {
  const copy = usePublishingCopy();
  const validation = useFormValidation();
  const params = useSearchParams();
  const month = params.get("month");
  const date = params.get("date") ?? (month ? `${month}-01` : today);
  return <form noValidate action="/publishing/calendar" method="get" className={styles.postFilters} key={params.toString()} onSubmit={event => { if (!validation.validate(event.currentTarget)) event.preventDefault(); }}>
    <p className="shell-subnav__label">{copy.calendarTitle}</p>
    <label htmlFor="calendar-view-filter">{copy.view}</label>
    <select id="calendar-view-filter" name="view" defaultValue={params.get("view") === "week" ? "week" : "month"}>
      <option value="month">{copy.month}</option>
      <option value="week">{copy.week}</option>
    </select>
    <label htmlFor="calendar-date-filter">{copy.goToDate}</label>
    <input id="calendar-date-filter" type="date" name="date" defaultValue={date} required aria-invalid={validation.fieldProps('date')['aria-invalid']} aria-describedby={validation.fieldProps('date')['aria-describedby']} />
    <FieldError {...validation.errorProps('date')} />
    <label htmlFor="calendar-channel-filter">{copy.channel}</label>
    <select id="calendar-channel-filter" name="channel" defaultValue={params.get("channel") ?? ""}>
      <PublishingChannelOptions channels={channels} selected={params.get("channel")} />
    </select>
    <label htmlFor="calendar-status-filter">{copy.status}</label>
    <select id="calendar-status-filter" name="status" defaultValue={params.get("status") ?? ""}>
      <option value="">{copy.allStatuses}</option>
      {STATUS_CHOICES.map((value) => <option value={value} key={value}>{value === 'pending_approval' || value === 'partially_failed' ? copy[`calendarStatus_${value}`] : copy[`status_${value}`]}</option>)}
    </select>
    {origins.length ? <>
      <label htmlFor="calendar-origin-filter">{originCopy[locale].filterLabel}</label>
      <select id="calendar-origin-filter" name="origin" defaultValue={params.get("origin") ?? ""}>
        <option value="">{originCopy[locale].anyOrigin}</option>
        {origins.map(option => <option value={option.kind} key={option.kind}>{option.label}</option>)}
      </select>
    </> : null}
    <button type="submit">{copy.apply}</button>
    <a href="/publishing/calendar">{copy.reset}</a>
  </form>;
}
