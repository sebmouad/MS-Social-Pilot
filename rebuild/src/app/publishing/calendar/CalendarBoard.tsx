"use client";

import { useRef, useState, type DragEvent } from "react";
import { useRouter } from "next/navigation";
import { Button, ChannelBadge, Dialog, StatusChip } from "@/components";
import { instantToWall, wallTimeToInstant } from "@/lib/calendar-dates";
import { formatWallTime, formatWhen, moveCandidates } from "@/lib/reschedule";
import { reschedulePostAction } from "./actions";
import type { BoardDay, BoardPost } from "./types";
import styles from "./calendar.module.css";

type Move = { post: BoardPost; step: "choose" | "confirm"; date: string; time: string; busy: boolean; error: string };
type Notice = { kind: "ok" | "error"; text: string } | null;

const hourLabel = (hour: number) => new Intl.DateTimeFormat("en-US", { hour: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(2000, 0, 1, hour)));
const pad = (n: number) => String(n).padStart(2, "0");

export function CalendarBoard({ view, days, timeZone, nowIso, canCreate, filterQuery, defaultScheduleTime }: { view: "month" | "week"; days: BoardDay[]; timeZone: string; nowIso: string; canCreate: boolean; filterQuery: string; defaultScheduleTime: string }) {
  const router = useRouter();
  const nowMs = Date.parse(nowIso);
  const [move, setMove] = useState<Move | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [over, setOver] = useState<string | null>(null);
  const dragged = useRef<BoardPost | null>(null);

  const timeOf = (post: BoardPost) => new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(new Date(post.whenIso));
  const startMove = (post: BoardPost) => { const wall = instantToWall(new Date(post.whenIso), timeZone); setNotice(null); setMove({ post, step: "choose", date: wall.date, time: wall.time, busy: false, error: "" }); };
  const dropOn = (event: DragEvent, date: string, time?: string) => {
    event.preventDefault(); setOver(null);
    const post = dragged.current; dragged.current = null;
    if (!post) return;
    const wall = instantToWall(new Date(post.whenIso), timeZone);
    setNotice(null);
    setMove({ post, step: "confirm", date, time: time ?? wall.time, busy: false, error: "" });
  };
  const dropProps = (key: string, date: string, time: string | undefined, disabled: boolean) => disabled ? {} : {
    onDragOver: (event: DragEvent) => { if (dragged.current) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; if (over !== key) setOver(key); } },
    onDragLeave: () => setOver(current => current === key ? null : current),
    onDrop: (event: DragEvent) => dropOn(event, date, time),
  };

  const postCard = (post: BoardPost) => <div key={post.id} className={styles.post} data-status={post.status} data-movable={post.movable || undefined}
    draggable={post.movable} onDragStart={event => { dragged.current = post; event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", post.id); }} onDragEnd={() => { dragged.current = null; setOver(null); }}>
    <div className={styles.postMeta}><time dateTime={post.whenIso}>{timeOf(post)}</time><StatusChip status={post.status} compact /></div>
    <p className={styles.postText} title={post.text}>{post.text || "No text included"}</p>
    <div className={styles.postChannels}>{post.channels.length ? post.channels.slice(0, 4).map(channel => <ChannelBadge key={channel.id} name={channel.name} platformName={channel.platformName} mark={channel.mark} compact />) : <span className={styles.muted}>No channels</span>}{post.channels.length > 4 && <span className={styles.muted}>+{post.channels.length - 4}</span>}</div>
    {post.movable && <button type="button" className={styles.moveButton} aria-haspopup="dialog" onClick={() => startMove(post)}>Move<span className="ui-visually-hidden"> post: {post.text.slice(0, 40) || "no text"}, scheduled {timeOf(post)}</span></button>}
  </div>;

  const newPostHref = (date: string, time: string) => `/publishing/compose?date=${date}&time=${time}`;
  const rangeIsEmpty = days.every(day => day.posts.length === 0);
  // Week view shows 6 AM to 11 PM, widened to include any hour that holds a post.
  const postHours = days.flatMap(day => day.posts.map(post => Number(instantToWall(new Date(post.whenIso), timeZone).time.slice(0, 2))));
  const firstHour = Math.min(6, ...postHours);
  const hours = Array.from({ length: 24 - firstHour }, (_, index) => firstHour + index);

  async function confirmMove() {
    if (!move) return;
    setMove({ ...move, busy: true, error: "" });
    try {
      const result = await reschedulePostAction({ postId: move.post.id, date: move.date, time: move.time });
      if (result.ok) { setNotice({ kind: "ok", text: `Post moved to ${formatWhen(result.scheduledAt, timeZone)}.` }); setMove(null); router.refresh(); }
      else setMove(current => current && { ...current, busy: false, error: result.error });
    } catch {
      setMove(current => current && { ...current, busy: false, error: "The post could not be moved. Check your connection and try again." });
    }
  }

  return <div className={styles.board}>
    <div className={styles.live} role="status" aria-live="polite">{notice?.kind === "ok" ? <p className={styles.noticeOk}>{notice.text}</p> : null}</div>
    {notice?.kind === "error" ? <p className={styles.noticeError} role="alert">{notice.text}</p> : null}
    <p className={styles.hint}>{canCreate ? "Select a day or time to start a new post. " : ""}Drag a scheduled post to another {view === "week" ? "time slot" : "day"}, or use its Move button. Times are in {timeZone.replaceAll("_", " ")}.{view === "week" && firstHour > 0 ? " Earlier hours appear when they hold a post." : ""}</p>

    {view === "month" ? <div className={styles.monthWrap}>
      <div className={styles.weekdays} aria-hidden="true">{days.slice(0, 7).map(day => <span key={day.key}>{new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" }).format(new Date(`${day.key}T12:00:00Z`))}</span>)}</div>
      <ol className={styles.month}>{days.map(day => {
        const dropKey = `d:${day.key}`;
        return <li key={day.key} className={styles.day} data-outside={!day.inMonth || undefined} data-past={day.isPast || undefined} data-today={day.isToday || undefined} data-over={over === dropKey || undefined} {...dropProps(dropKey, day.key, undefined, day.isPast)}>
          <div className={styles.dayHead}><time dateTime={day.key} aria-label={day.longLabel + (day.isToday ? " (today)" : "")}>{Number(day.key.slice(8))}</time>{day.isToday && <span className={styles.todayTag}>Today</span>}</div>
          {day.posts.slice(0, 3).map(postCard)}
          {day.posts.length > 3 && <a className={styles.more} href={`/publishing/calendar?view=week&date=${day.key}${filterQuery}`}>+{day.posts.length - 3} more<span className="ui-visually-hidden"> on {day.longLabel}</span></a>}
          {canCreate && !day.isPast && <a className={styles.add} href={newPostHref(day.key, defaultScheduleTime)}>+ New post<span className="ui-visually-hidden"> on {day.longLabel}</span></a>}
        </li>;
      })}</ol>
    </div> : <div className={styles.weekWrap}><div className={styles.week} style={{ gridTemplateColumns: "52px repeat(7, minmax(0, 1fr))" }}>
      <span className={styles.corner} aria-hidden="true" />
      {days.map(day => <div key={day.key} className={styles.weekHead} data-today={day.isToday || undefined}><time dateTime={day.key} aria-label={day.longLabel + (day.isToday ? " (today)" : "")}>{day.label}</time>{day.isToday && <span className={styles.todayTag}>Today</span>}</div>)}
      {hours.map(hour => [
        <span key={`h${hour}`} className={styles.hourLabel} aria-hidden="true">{hourLabel(hour)}</span>,
        ...days.map(day => {
          const time = `${pad(hour)}:00`;
          const slotPosts = day.posts.filter(post => Number(instantToWall(new Date(post.whenIso), timeZone).time.slice(0, 2)) === hour);
          const slotInstant = wallTimeToInstant(day.key, time, timeZone);
          const slotEnded = slotInstant.ok ? slotInstant.instant.getTime() + 3600_000 <= nowMs : day.isPast;
          const dropKey = `s:${day.key}:${hour}`;
          return <div key={dropKey} role="group" aria-label={`${day.longLabel}, ${hourLabel(hour)}`} className={styles.slot} data-past={slotEnded || undefined} data-over={over === dropKey || undefined} {...dropProps(dropKey, day.key, time, day.isPast)}>
            {slotPosts.map(postCard)}
            {canCreate && !slotEnded && <a className={styles.slotAdd} href={newPostHref(day.key, time)} aria-label={`New post on ${day.longLabel} at ${hourLabel(hour)}`}><span aria-hidden="true">+</span></a>}
          </div>;
        }),
      ])}
    </div></div>}

    <section className={styles.agenda} aria-label="Agenda">
      {days.filter(day => view === "week" || day.posts.length > 0).map(day => <div className={styles.agendaDay} key={day.key}>
        <div className={styles.agendaHead}><h3><time dateTime={day.key}>{day.longLabel}</time>{day.isToday && <span className={styles.todayTag}>Today</span>}</h3>{canCreate && !day.isPast && <a className={styles.agendaAdd} href={newPostHref(day.key, defaultScheduleTime)}>+ New post<span className="ui-visually-hidden"> on {day.longLabel}</span></a>}</div>
        {day.posts.length ? <div className={styles.agendaPosts}>{day.posts.map(postCard)}</div> : <p className={styles.muted}>Nothing planned.</p>}
      </div>)}
      {rangeIsEmpty && view === "month" && <p className={styles.muted}>Nothing is scheduled or published this month.</p>}
    </section>

    {rangeIsEmpty && <p className={styles.empty}>Nothing is scheduled or published {view === "week" ? "this week" : "this month"}. {canCreate ? "Pick a day to plan a post." : "Planned posts will appear here."}</p>}

    <MoveDialog move={move} timeZone={timeZone} nowMs={nowMs} onChange={setMove} onConfirm={() => void confirmMove()} />
  </div>;
}

function MoveDialog({ move, timeZone, nowMs, onChange, onConfirm }: { move: Move | null; timeZone: string; nowMs: number; onChange: (next: Move | null) => void; onConfirm: () => void }) {
  if (!move) return null;
  const close = () => { if (!move.busy) onChange(null); };
  const current = formatWhen(move.post.whenIso, timeZone);
  const resolved = wallTimeToInstant(move.date, move.time, timeZone);
  const problem = !resolved.ok ? (resolved.reason === "skipped" ? "That time does not exist on that day because the clocks change. Choose another time." : "Choose a valid date and time.")
    : resolved.instant.getTime() <= nowMs ? "That time has already passed. Choose a later time."
    : resolved.instant.getTime() === new Date(move.post.whenIso).getTime() ? "The post is already scheduled for that time." : "";
  const preview = formatWallTime(move.date, move.time, timeZone);

  if (move.step === "choose") {
    const options = moveCandidates(move.post.whenIso, timeZone, nowMs);
    return <Dialog open busy={move.busy} title="Move scheduled post" description={`Currently scheduled for ${current}.`} onClose={close}
      actions={<Button variant="secondary" onClick={close}>Cancel</Button>}>
      <p className={styles.dialogPost}>{move.post.text.slice(0, 160) || "No text included"}</p>
      <ul className={styles.moveOptions}>{options.map(option => <li key={option.id}>
        <button type="button" className="ui-button ui-button--secondary ui-button--md" disabled={Boolean(option.unavailable)} onClick={() => onChange({ ...move, step: "confirm", date: option.date, time: option.time, error: "" })}>{option.label}</button>
        {option.unavailable && <span className={styles.muted}>{option.unavailable === "past" ? "Already passed" : "Clocks change"}</span>}
      </li>)}</ul>
      <form className={styles.pickForm} onSubmit={event => { event.preventDefault(); onChange({ ...move, step: "confirm", error: "" }); }}>
        <fieldset><legend>Pick a date and time</legend>
          <label>Date<input type="date" required value={move.date} onChange={event => onChange({ ...move, date: event.target.value })} /></label>
          <label>Time<input type="time" required value={move.time} onChange={event => onChange({ ...move, time: event.target.value })} /></label>
        </fieldset>
        <Button type="submit" variant="primary">Review move</Button>
      </form>
    </Dialog>;
  }

  return <Dialog open busy={move.busy} title="Confirm new time" description="The post stays scheduled and publishes at the new time." onClose={close}
    actions={<><Button variant="quiet" disabled={move.busy} onClick={() => onChange({ ...move, step: "choose", error: "" })}>Choose another time</Button><Button variant="primary" disabled={move.busy || Boolean(problem)} onClick={onConfirm}>{move.busy ? "Moving…" : "Move post"}</Button></>}>
    <p className={styles.dialogPost}>{move.post.text.slice(0, 160) || "No text included"}</p>
    <dl className={styles.times}><div><dt>Now</dt><dd>{current}</dd></div><div><dt>New time</dt><dd>{preview ?? "Not a valid time"}</dd></div></dl>
    <p className={styles.muted}>Times are in {timeZone.replaceAll("_", " ")}.</p>
    {(problem || move.error) && <p className={styles.dialogError} role="alert">{move.error || problem}</p>}
  </Dialog>;
}
