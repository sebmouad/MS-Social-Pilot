"use client";
import { synchronousPolicy } from '@/lib/config/synchronous-policy';

import { usePublishingCopy, usePublishingLocale } from '../kit/CopyProvider';
import { fillCopy } from '../kit/copy';
import { FieldError, useFormValidation } from '@/components/FormValidation';
import { useRef, useState, type DragEvent } from "react";
import { useRouter } from "next/navigation";
import { Button, ChannelBadge, Dialog, StatusChip } from "@/components";
import { OriginBadge } from "../origins/OriginBadge";
import { PostPreview } from "@/components/PostPreview";
import { PostThumb } from "@/components/PostThumb";
import { postThumbnail } from "@/components/post-thumbnail";
import { useContent } from "../ContentProvider";
import { instantToWall, wallTimeToInstant } from "@/lib/calendar-dates";
import { moveCandidates } from "@/lib/reschedule";
import { reschedulePostAction } from "./actions";
import type { BoardDay, BoardPost } from "./types";
import styles from "./calendar.module.css";

type Move = { post: BoardPost; step: "choose" | "confirm"; date: string; time: string; busy: boolean; error: string };
type Notice = { kind: "ok" | "error"; text: string } | null;

const hourLabel = (hour: number, locale: string = "en-US") => new Intl.DateTimeFormat(locale, { hour: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(2000, 0, 1, hour)));
const pad = (n: number) => String(n).padStart(2, "0");

export function CalendarBoard({ view, days, timeZone, nowIso, canCreate, filterQuery, defaultScheduleTime }: { view: "month" | "week"; days: BoardDay[]; timeZone: string; nowIso: string; canCreate: boolean; filterQuery: string; defaultScheduleTime: string }) {
  const copy = usePublishingCopy();
  const locale = usePublishingLocale();
  const { copy: content, policy } = useContent();
  const router = useRouter();
  const nowMs = Date.parse(nowIso);
  const [move, setMove] = useState<Move | null>(null);
  const [previewPost, setPreviewPost] = useState<BoardPost | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [over, setOver] = useState<string | null>(null);
  const dragged = useRef<BoardPost | null>(null);

  const timeOf = (post: BoardPost) => post.clockLabel ?? new Intl.DateTimeFormat(locale === "fr" ? "fr-FR" : "en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(new Date(post.whenIso));
  const startMove = (post: BoardPost) => { const wall = post.wallTime ?? instantToWall(new Date(post.whenIso), timeZone); setNotice(null); setMove({ post, step: "choose", date: wall.date, time: wall.time, busy: false, error: "" }); };
  const dropOn = (event: DragEvent, date: string, time?: string) => {
    event.preventDefault(); setOver(null);
    const post = dragged.current; dragged.current = null;
    if (!post) return;
    const wall = post.wallTime ?? instantToWall(new Date(post.whenIso), timeZone);
    setNotice(null);
    setMove({ post, step: "confirm", date, time: time ?? wall.time, busy: false, error: "" });
  };
  const dropProps = (key: string, date: string, time: string | undefined, disabled: boolean) => disabled ? {} : {
    onDragOver: (event: DragEvent) => { if (dragged.current) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; if (over !== key) setOver(key); } },
    onDragLeave: () => setOver(current => current === key ? null : current),
    onDrop: (event: DragEvent) => dropOn(event, date, time),
  };

  const postCard = (post: BoardPost) => <div key={post.id} className={styles.post} data-status={post.status} data-movable={post.movable || undefined} style={post.channels[0] ? { ["--chip" as string]: post.channels[0].mark.color } : undefined}
    draggable={post.movable} onDragStart={event => { dragged.current = post; event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", post.id); }} onDragEnd={() => { dragged.current = null; setOver(null); }}>
    <div className={styles.postMeta}><time dateTime={post.whenIso}>{timeOf(post)}</time><StatusChip status={post.status} compact /></div>
    <div className={styles.postBody}>
      {post.preview && postThumbnail(post.preview.media) ? <PostThumb thumb={postThumbnail(post.preview.media)} size="sm" /> : null}
      <p className={styles.postText} title={post.text}>{post.text || copy.calendarNoText}</p>
    </div>
    {post.origin ? <OriginBadge origin={post.origin} compact /> : null}
    <div className={styles.postChannels}>{post.channels.length ? post.channels.slice(0, 4).map(channel => <ChannelBadge key={channel.id} name={channel.name} platformName={channel.platformName} mark={channel.mark} compact />) : <span className={styles.muted}>{copy.calendarNoChannels}</span>}{post.channels.length > 4 && <span className={styles.muted}>+{post.channels.length - 4}</span>}</div>
    {post.movable && <button type="button" className={styles.moveButton} aria-haspopup="dialog" onClick={() => startMove(post)}>{copy.move}<span className="ui-visually-hidden">{fillCopy(copy.movePostLabel, {text: post.text.slice(0, 40) || copy.noText, time: timeOf(post)})}</span></button>}
    {post.preview && <button type="button" className={styles.viewButton} aria-haspopup="dialog" aria-label={fillCopy(copy.viewPostLabel, {text:post.text.slice(0,60) || copy.noText})} onClick={() => setPreviewPost(post)}>{copy.viewPost}</button>}
  </div>;

  const milestoneList = (day: BoardDay) => day.milestones?.length
    ? <ul className={styles.milestones} aria-label={day.longLabel}>{day.milestones.map(item => <li key={item.id} title={item.title}>{item.title}</li>)}</ul> : null;
  const newPostHref = (date: string, time: string) => `/create?date=${date}&time=${time}`;
  /** Free queue times appear as dashed pills; one opens Create already set to that time. */
  const freePill = (day: BoardDay, time: string) => <a key={`free-${day.key}-${time}`} className={styles.freeSlot} href={newPostHref(day.key, time)} aria-label={fillCopy(content.calendarFreeSlotLabel, { day: day.longLabel, time })}>{fillCopy(content.calendarFreeSlot, { time })}</a>;
  const rangeIsEmpty = days.every(day => day.posts.length === 0);
  // Week view shows 6 AM to 11 PM, widened to include any hour that holds a post.
  const postHours = days.flatMap(day => day.posts.map(post => Number((post.wallTime ?? instantToWall(new Date(post.whenIso), timeZone)).time.slice(0, 2))));
  const firstHour = Math.min(6, ...postHours);
  const hours = Array.from({ length: 24 - firstHour }, (_, index) => firstHour + index);

  async function confirmMove() {
    if (!move) return;
    setMove({ ...move, busy: true, error: "" });
    try {
      const result = await reschedulePostAction({ postId: move.post.id, date: move.date, time: move.time });
      if (result.ok) { setNotice({ kind: "ok", text: fillCopy(copy.movedTo, {time: result.displayTime ?? fillCopy(copy.atTime, {date:move.date,time:move.time}), zone:timeZone.replaceAll("_", " ")}) }); setMove(null); router.refresh(); }
      else setMove(current => current && { ...current, busy: false, error: result.error });
    } catch {
      setMove(current => current && { ...current, busy: false, error: copy.moveFailed });
    }
  }

  return <div className={styles.board}>
    <div className={styles.live} role="status" aria-live="polite">{notice?.kind === "ok" ? <p className={styles.noticeOk}>{notice.text}</p> : null}</div>
    {notice?.kind === "error" ? <p className={styles.noticeError} role="alert">{notice.text}</p> : null}
    <p className={styles.hint}>{canCreate ? copy.startNew : ""}{fillCopy(copy.dragHint, {slot:view === "week" ? copy.timeSlot : copy.daySlot,zone:timeZone.replaceAll("_", " ")})}{view === "week" && firstHour > 0 ? copy.earlierHours : ""}</p>

    {view === "month" ? <div className={styles.monthWrap}>
      <div className={styles.weekdays} aria-hidden="true">{days.slice(0, 7).map(day => <span key={day.key}>{new Intl.DateTimeFormat(locale === "fr" ? "fr-FR" : "en-US", { weekday: "short", timeZone: "UTC" }).format(new Date(`${day.key}T12:00:00Z`))}</span>)}</div>
      <ol className={styles.month}>{days.map(day => {
        const dropKey = `d:${day.key}`;
        return <li key={day.key} className={styles.day} data-outside={!day.inMonth || undefined} data-past={day.isPast || undefined} data-today={day.isToday || undefined} data-over={over === dropKey || undefined} {...dropProps(dropKey, day.key, undefined, day.isPast)}>
          <div className={styles.dayHead}><time dateTime={day.key} aria-label={day.longLabel + (day.isToday ? copy.todaySuffix : "")}>{Number(day.key.slice(8))}</time>{day.isToday && <span className={styles.todayTag}>{copy.today}</span>}</div>
          {milestoneList(day)}
          {day.posts.slice(0, policy.monthPostsShown).map(postCard)}
          {day.posts.length > policy.monthPostsShown && <a className={styles.more} href={`/content/calendar?view=week&date=${day.key}${filterQuery}`}>+{day.posts.length - policy.monthPostsShown}{copy.more}<span className="ui-visually-hidden">{copy.onDay}{day.longLabel}</span></a>}
          {canCreate && !day.isPast && day.freeSlots?.map(time => freePill(day, time))}
          {canCreate && !day.isPast && <a className={styles.add} href={newPostHref(day.key, defaultScheduleTime)}>{copy.addPost}<span className="ui-visually-hidden">{copy.onDay}{day.longLabel}</span></a>}
        </li>;
      })}</ol>
    </div> : <div className={styles.weekWrap}><div className={styles.week} style={{ gridTemplateColumns: "52px repeat(7, minmax(0, 1fr))" }}>
      <span className={styles.corner} aria-hidden="true" />
      {days.map(day => <div key={day.key} className={styles.weekHead} data-today={day.isToday || undefined}><time dateTime={day.key} aria-label={day.longLabel + (day.isToday ? copy.todaySuffix : "")}>{day.label}</time>{day.isToday && <span className={styles.todayTag}>{copy.today}</span>}{milestoneList(day)}</div>)}
      {hours.map(hour => [
        <span key={`h${hour}`} className={styles.hourLabel} aria-hidden="true">{hourLabel(hour, locale)}</span>,
        ...days.map(day => {
          const time = `${pad(hour)}:00`;
          const slotPosts = day.posts.filter(post => Number((post.wallTime ?? instantToWall(new Date(post.whenIso), timeZone)).time.slice(0, 2)) === hour);
          const slotInstant = wallTimeToInstant(day.key, time, timeZone);
          const slotEnded = day.slotEndedByHour?.[time] ?? (slotInstant.ok ? slotInstant.instant.getTime() + 3600_000 <= nowMs : day.isPast);
          const dropKey = `s:${day.key}:${hour}`;
          return <div key={dropKey} role="group" aria-label={`${day.longLabel}, ${hourLabel(hour, locale)}`} className={styles.slot} data-past={slotEnded || undefined} data-over={over === dropKey || undefined} {...dropProps(dropKey, day.key, time, day.isPast || slotEnded)}>
            {slotPosts.map(postCard)}
            {canCreate && !slotEnded && day.freeSlots?.filter(free => Number(free.slice(0, 2)) === hour).map(free => freePill(day, free))}
            {canCreate && !slotEnded && <a className={styles.slotAdd} href={newPostHref(day.key, time)} aria-label={fillCopy(copy.newPostLabel, {day:day.longLabel,time:hourLabel(hour, locale)})}><span aria-hidden="true">+</span></a>}
          </div>;
        }),
      ])}
    </div></div>}

    <section className={styles.agenda} aria-label={copy.agenda}>
      {days.filter(day => view === "week" || day.posts.length > 0 || day.milestones?.length).map(day => <div className={styles.agendaDay} key={day.key}>
        <div className={styles.agendaHead}><h3><time dateTime={day.key}>{day.longLabel}</time>{day.isToday && <span className={styles.todayTag}>{copy.today}</span>}</h3>{canCreate && !day.isPast && <a className={styles.agendaAdd} href={newPostHref(day.key, defaultScheduleTime)}>{copy.addPost}<span className="ui-visually-hidden">{copy.onDay}{day.longLabel}</span></a>}</div>
        {milestoneList(day)}
        {day.posts.length ? <div className={styles.agendaPosts}>{day.posts.map(postCard)}</div> : <p className={styles.muted}>{copy.nothingPlanned}</p>}
      </div>)}
      {rangeIsEmpty && view === "month" && <p className={styles.muted}>{copy.monthEmpty}</p>}
    </section>

    {rangeIsEmpty && <p className={styles.empty}>{view === "week" ? copy.weekEmpty : copy.monthEmpty} {canCreate ? copy.pickDay : copy.plannedAppear}</p>}

    {previewPost?.preview && <Dialog open title={copy.previewTitle} description={copy.previewDescription} onClose={() => setPreviewPost(null)}
      actions={<Button variant="secondary" onClick={() => setPreviewPost(null)}>{copy.close}</Button>}>
      <PostPreview post={previewPost.preview} authorName={previewPost.authorName ?? copy.approvalsMember} timeZone={timeZone} />
    </Dialog>}
    <MoveDialog move={move} timeZone={timeZone} nowMs={nowMs} onChange={setMove} onConfirm={() => void confirmMove()} />
  </div>;
}

function MoveDialog({ move, timeZone, nowMs, onChange, onConfirm }: { move: Move | null; timeZone: string; nowMs: number; onChange: (next: Move | null) => void; onConfirm: () => void }) {
  const copy = usePublishingCopy();
  const locale = usePublishingLocale();
  const validation = useFormValidation();
  if (!move) return null;
  const close = () => { if (!move.busy) onChange(null); };
  const validShape = /^\d{4}-\d{2}-\d{2}$/.test(move.date) && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(move.time);
  const currentWall = move.post.wallTime ?? instantToWall(new Date(move.post.whenIso), timeZone);
  const current = fillCopy(copy.atTime, {date:currentWall.date,time:currentWall.time});
  const problem = !validShape ? copy.chooseDateTime : move.date === currentWall.date && move.time === currentWall.time ? copy.alreadyScheduled : "";
  const preview = validShape ? fillCopy(copy.atTime, {date:move.date,time:move.time}) : null;

  if (move.step === "choose") {
    const options = move.post.moveOptions ?? moveCandidates(move.post.whenIso, timeZone, nowMs, { ...synchronousPolicy("shared.reschedulePolicy"), locale: locale === "fr" ? "fr-FR" : "en-US" });
    return <Dialog open busy={move.busy} title={copy.moveScheduled} description={fillCopy(copy.currentlyScheduled, {time:current})} onClose={close}
      actions={<Button variant="secondary" onClick={close}>{copy.cancel}</Button>}>
      <p className={styles.dialogPost}>{move.post.text.slice(0, 160) || copy.calendarNoText}</p>
      <ul className={styles.moveOptions}>{options.map(option => <li key={option.id}>
        <button type="button" className="ui-button ui-button--secondary ui-button--md" disabled={Boolean(option.unavailable)} onClick={() => onChange({ ...move, step: "confirm", date: option.date, time: option.time, error: "" })}>{option.label}</button>
        {option.unavailable && <span className={styles.muted}>{option.unavailable === "past" ? copy.alreadyPassed : copy.clocksChange}</span>}
      </li>)}</ul>
      <form noValidate method="post" className={styles.pickForm} onSubmit={event => { event.preventDefault(); if (!validation.validate(event.currentTarget)) return; onChange({ ...move, step: "confirm", error: "" }); }}>
        <fieldset><legend>{copy.pickDateTime}</legend>
          <label>{copy.date}<input {...validation.fieldProps('date')} name="date" type="date" required value={move.date} onChange={event => onChange({ ...move, date: event.target.value })} /><FieldError {...validation.errorProps('date')} /></label>
          <label>{copy.time}<input {...validation.fieldProps('time')} name="time" type="time" required value={move.time} onChange={event => onChange({ ...move, time: event.target.value })} /><FieldError {...validation.errorProps('time')} /></label>
        </fieldset>
        <Button type="submit" variant="primary">{copy.reviewMove}</Button>
      </form>
    </Dialog>;
  }

  return <Dialog open busy={move.busy} title={copy.confirmNewTime} description={copy.moveDescription} onClose={close}
    actions={<><Button variant="quiet" disabled={move.busy} onClick={() => onChange({ ...move, step: "choose", error: "" })}>{copy.chooseAnotherTime}</Button><Button variant="primary" disabled={move.busy || Boolean(problem)} onClick={onConfirm}>{move.busy ? copy.moving : copy.movePost}</Button></>}>
    <p className={styles.dialogPost}>{move.post.text.slice(0, 160) || copy.calendarNoText}</p>
    <dl className={styles.times}><div><dt>{copy.now}</dt><dd>{current}</dd></div><div><dt>{copy.newTime}</dt><dd>{preview ?? copy.invalidTime}</dd></div></dl>
    <p className={styles.muted}>{fillCopy(copy.timesIn, {zone:timeZone.replaceAll("_", " ")})}</p>
    {(problem || move.error) && <p className={styles.dialogError} role="alert">{move.error || problem}</p>}
  </Dialog>;
}
