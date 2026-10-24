'use client';
import { useRef, useState, type ReactNode } from 'react';
import { IconBulb, IconCheck, IconFlask, IconPlus, IconTrophy } from '@tabler/icons-react';
import { AutoTextarea } from '@/components/AutoTextarea';
import { FieldError, useFormValidation } from '@/components/FormValidation';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';
import { useConfirm } from '@/components/useConfirm';
import { fill, type CaptionTestsCopy } from '../copy';
import type { CaptionTestView as BaseCaptionTestView } from '../server/service';
/** A test with server-formatted workspace-zone date labels (see `@/server/instant-labels`). */
export type CaptionTestView = BaseCaptionTestView & { labels?: { createdAt?: string; dueAt?: string } };
import styles from './caption-tests.module.css';

type Post = { id: string; message: string; status: string };
export type CaptionAction = { type: 'start'; input: { name?: string; hours?: number; minViews?: number; confirmation: string } & ({ postIds: string[] } | { captions: string[]; targetIds: string[]; link?: string }) } | { type: 'learn'; id: string; confirmation: string };
export type CaptionActionResult = { ok?: true; error?: string; tests?: CaptionTestView[]; posts?: Post[] };
type Limits = { minCaptions: number; maxCaptions: number; defaultHours: number; minHours: number; maxHours: number; defaultMinViews: number; maxMinViews: number; captionMaxCharacters?: number; nameMaxCharacters?: number; targetLimit?: number };

/** Place a date component inside a catalog sentence written with a {date} placeholder. */
function withDate(template: string, date: ReactNode) {
  const [before = '', after = ''] = template.split('{date}');
  return <>{before}{date}{after}</>;
}
const REASONS = { not_enough_views: 'notEnoughViews', not_published: 'notPublished', no_insights: 'noInsights', tie: 'tie' } as const;

function statusOf(test: CaptionTestView, t: CaptionTestsCopy, numberFormat: Intl.NumberFormat) {
  if (test.status === 'running') return { tone: 'brand' as const, text: test.dueAt ? withDate(t.runningUntil, <time dateTime={test.dueAt}>{test.labels?.dueAt ?? ''}</time>) : t.running };
  if (test.status === 'decided') return { tone: 'success' as const, text: test.lift !== null ? fill(t.winnerLift, { label: test.winnerLabel ?? '', lift: numberFormat.format(Math.round(test.lift)) }) : fill(t.winner, { label: test.winnerLabel ?? '' }) };
  const key = REASONS[(test.reason ?? 'not_enough_views') as keyof typeof REASONS] ?? 'notEnoughViews';
  return { tone: 'warning' as const, text: fill(t[key], { views: numberFormat.format(test.minViews) }) };
}

/** Results of every caption test, with a start form and the "add to workspace voice" action. */
export function CaptionTestsScreen({ tests: initialTests, posts: initialPosts, channels = [], canLearn, canStart, limits, copy: t, locale, execute }: {
  tests: CaptionTestView[]; posts: Post[]; channels?: Array<{ id: string; name: string }>; canLearn: boolean; canStart: boolean; limits: Limits; copy: CaptionTestsCopy; locale: 'en' | 'fr'; execute: (action: CaptionAction) => Promise<CaptionActionResult>;
}) {
  const validation = useFormValidation();
  const [pending, setPending] = useState(false);
  const [tests, setTests] = useState(initialTests); const [posts, setPosts] = useState(initialPosts);
  const [feedback, setFeedback] = useState(''); const [error, setError] = useState('');
  const [source, setSource] = useState('posts');
  const [captions, setCaptions] = useState<string[]>(() => Array.from({ length: limits.minCaptions }, () => ''));
  const [targetIds, setTargetIds] = useState<string[]>([]); const [link, setLink] = useState('');
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string[]>(() => Array.from({ length: limits.minCaptions }, () => ''));
  const [name, setName] = useState(''); const [hours, setHours] = useState(String(limits.defaultHours)); const [minViews, setMinViews] = useState(String(limits.defaultMinViews));
  const status = useRef<HTMLParagraphElement>(null);
  const numberFormat = new Intl.NumberFormat(locale === 'fr' ? 'fr-FR' : 'en-GB');
  const percent = new Intl.NumberFormat(locale === 'fr' ? 'fr-FR' : 'en-GB', { style: 'percent', maximumFractionDigits: 1 });
  const [ask, dialog] = useConfirm({ title: t.confirm, cancel: t.cancel, confirm: t.confirm, danger: false });

  const chosen = picked.filter(Boolean);
  const startable = source === 'variants' ? captions.every(caption => caption.trim()) && new Set(captions.map(caption => caption.trim())).size === captions.length && targetIds.length > 0 : chosen.length >= limits.minCaptions && new Set(chosen).size === chosen.length;
  /** Keep confirmation and recoverable errors together in the shared dialog. */
  async function run(action: CaptionAction, question: string, success: string, failure: string, after?: () => void) {
    setError(''); setFeedback('');
    if (pending) return;
    const exactConfirmation = action.type === 'learn' ? `LEARN ${action.id}` : 'captions' in action.input ? 'CREATE CAPTION TEST DRAFTS' : 'START CAPTION TEST';
    await ask(question, { exactConfirmation, confirmationLabel: t.confirmation, pendingLabel: t.busy, failureLabel: failure, onConfirm: async () => {
      setPending(true);
      try {
        const result = await execute(action);
        if (result.error) return result.error || failure;
        if (result.tests) setTests(result.tests); if (result.posts) setPosts(result.posts);
        setFeedback(success); after?.(); status.current?.focus(); return null;
      } catch { return failure; } finally { setPending(false); }
    } });
  }

  const submit = () => run({ type: 'start', input: { ...(name.trim() ? { name: name.trim() } : {}), hours: Number(hours), minViews: Number(minViews), ...(source === 'variants' ? { captions, targetIds, ...(link.trim() ? { link: link.trim() } : {}) } : { postIds: chosen }), confirmation: source === 'variants' ? 'CREATE CAPTION TEST DRAFTS' : 'START CAPTION TEST' } }, source === 'variants' ? t.rawConfirm : t.startConfirm, t.startedDone, t.errUpstream, () => { setOpen(false); setPicked(Array.from({ length: limits.minCaptions }, () => '')); setName(''); setCaptions(Array.from({ length: limits.minCaptions }, () => '')); setTargetIds([]); setLink(''); validation.clearAll(); });

  return <section className={styles.root} data-module="analytics" aria-busy={pending}>
    <PageHeader module="analytics" title={t.title} description={t.intro}
      actions={canStart ? <Button variant="primary" leading={<IconPlus size={16} />} aria-expanded={open} aria-controls="caption-start" onClick={() => setOpen(value => !value)}>{t.startHeading}</Button> : undefined} />
    <p ref={status} tabIndex={-1} role="status" className={feedback ? styles.ok : styles.hidden}>{feedback ? <><IconCheck size={16} aria-hidden="true" /> {feedback}</> : null}</p>
    {error ? <p role="alert" className={styles.error}>{error}</p> : null}

    {canStart && open ? <form id="caption-start" className={styles.panel} noValidate onSubmit={event => { event.preventDefault(); if (validation.validate(event.currentTarget) && startable) submit(); }}>
      <h2><IconFlask size={20} aria-hidden="true" /> {t.startHeading}</h2>
      <label className="ui-field"><span>{t.source}</span><select className="ui-input" value={source} onChange={event => setSource(event.target.value)}><option value="posts">{t.existingPosts}</option><option value="variants">{t.rawCaptions}</option></select></label>
      <p className={styles.hint}>{source === 'variants' ? t.rawHint : t.startHint}</p>
      {source === 'posts' && posts.length === 0 ? <p>{t.noPosts}</p> : <>
        {source === 'variants' ? <>
          <div className={styles.pickers}>{captions.map((caption, index) => <label key={index} className="ui-field"><span>{t.colCaption} · {'ABCD'[index]}</span><AutoTextarea {...validation.fieldProps(`caption-${index}`)} name={`caption-${index}`} disabled={pending} className="ui-input" rows={4} maxLength={limits.captionMaxCharacters} value={caption} onChange={event => setCaptions(list => list.map((value, at) => at === index ? event.target.value : value))} required /><FieldError {...validation.errorProps(`caption-${index}`)} /></label>)}</div>
          {captions.length < limits.maxCaptions ? <Button type="button" size="sm" disabled={pending} leading={<IconPlus size={14} />} onClick={() => setCaptions(list => [...list, ''])}>{t.addCaption}</Button> : null}
          <p className={styles.hint}>{channels.length ? fill(t.channelLimitHint, { max: limits.targetLimit ?? channels.length }) : t.noChannels}</p>
          <label className="ui-field"><span>{t.channels}</span><select {...validation.fieldProps("targetIds")} disabled={pending} name="targetIds" className="ui-input" multiple value={targetIds} onChange={event => setTargetIds(Array.from(event.target.selectedOptions, option => option.value).slice(0, limits.targetLimit))} required>{channels.map(channel => <option key={channel.id} value={channel.id} disabled={!targetIds.includes(channel.id) && limits.targetLimit !== undefined && targetIds.length >= limits.targetLimit}>{channel.name}</option>)}</select><FieldError {...validation.errorProps("targetIds")} /></label>
          <label className="ui-field"><span>{t.link}</span><input {...validation.fieldProps("link")} disabled={pending} name="link" className="ui-input" type="url" value={link} onChange={event => setLink(event.target.value)} /><FieldError {...validation.errorProps("link")} /></label>
        </> : <>
        <div className={styles.pickers}>
          {picked.map((value, index) => <label key={index} className="ui-field">
            <span><span className={styles.letter} aria-hidden="true">{'ABCD'[index]}</span> {t.posts} · {'ABCD'[index]}</span>
            <select {...validation.fieldProps(`post-${index}`)} name={`post-${index}`} className="ui-input" value={value} disabled={pending} onChange={event => setPicked(list => list.map((item, position) => position === index ? event.target.value : item))} required={index < limits.minCaptions}>
              <option value="">—</option>
              {posts.filter(post => post.id === value || !picked.includes(post.id)).map(post => <option key={post.id} value={post.id}>{post.message.trim().slice(0, 90) || post.id}</option>)}
            </select><FieldError {...validation.errorProps(`post-${index}`)} />
          </label>)}
        </div>
        {picked.length < limits.maxCaptions ? <Button size="sm" leading={<IconPlus size={14} />} disabled={pending} onClick={() => setPicked(list => [...list, ''])}>{t.posts}</Button> : null}
        </>}
        <div className={styles.fields}>
          <label className="ui-field"><span>{t.name}</span><input {...validation.fieldProps("name")} name="name" className="ui-input" value={name} maxLength={limits.nameMaxCharacters} disabled={pending} onChange={event => setName(event.target.value)} autoComplete="off" /><FieldError {...validation.errorProps("name")} /></label>
          <label className="ui-field"><span>{t.hours}</span><input {...validation.fieldProps("hours")} name="hours" className="ui-input" type="number" inputMode="numeric" min={limits.minHours} max={limits.maxHours} value={hours} disabled={pending} onChange={event => setHours(event.target.value)} required /><FieldError {...validation.errorProps("hours")} /></label>
          <label className="ui-field"><span>{t.minViews}</span><input {...validation.fieldProps("minViews")} name="minViews" className="ui-input" type="number" inputMode="numeric" min={1} max={limits.maxMinViews} value={minViews} disabled={pending} onChange={event => setMinViews(event.target.value)} required /><FieldError {...validation.errorProps("minViews")} /></label>
        </div>
        {!startable && chosen.length ? <p className={styles.hint}>{chosen.length < limits.minCaptions ? t.pickTwo : fill(t.pickMost, { max: limits.maxCaptions })}</p> : null}
        <div className={styles.actions}><Button type="submit" variant="primary" busy={pending} disabled={!startable}>{pending ? t.busy : t.startRun}</Button></div>
      </>}
    </form> : null}

    {tests.length === 0 ? <EmptyState icon={<IconFlask size={22} />} title={t.emptyTitle}>{t.emptyHint}</EmptyState> : <ul className={styles.list}>
      {tests.map(test => {
        const state = statusOf(test, t, numberFormat);
        const best = Math.max(0, ...test.results.map(result => result.rate ?? 0));
        return <li key={test.id} className={styles.card}>
          <header className={styles.cardHead}>
            <div className={styles.title}><h2>{test.name || t.untitled}</h2><p>{withDate(t.started, <time dateTime={test.createdAt}>{test.labels?.createdAt ?? ''}</time>)}</p></div>
            <Badge tone={state.tone} icon={test.status === 'decided' ? <IconTrophy size={14} /> : undefined}>{state.text}</Badge>
          </header>
          <ol className={styles.captions}>
            {test.posts.map(post => {
              const result = test.results.find(item => item.label === post.label);
              const won = test.status === 'decided' && post.label === test.winnerLabel;
              const width = result?.rate && best > 0 ? Math.max(3, Math.round(result.rate / best * 100)) : 0;
              return <li key={post.id} className={`${styles.caption} ${won ? styles.won : ''}`}>
                <span className={styles.letter} aria-hidden="true">{post.label}</span>
                <div className={styles.body}>
                  <p className={styles.message}><span className="ui-visually-hidden">{t.colCaption} {post.label}{won ? ` · ${t.winnerShort}` : ''}. </span>{post.message}</p>
                  <p className={styles.channels}>{post.channels.map(channel => channel.name).join(', ')}</p>
                  <div className={styles.bar} role="img" aria-label={`${t.colRate}: ${result?.rate != null ? percent.format(result.rate) : t.unknown}`}><span style={{ width: `${width}%` }} /></div>
                </div>
                <dl className={styles.figures}>
                  <div><dt>{t.colViews}</dt><dd>{result?.views != null ? numberFormat.format(result.views) : '—'}</dd></div>
                  <div><dt>{t.colEngagements}</dt><dd>{result?.engagements != null ? numberFormat.format(result.engagements) : '—'}</dd></div>
                  <div><dt>{t.colRate}</dt><dd>{result?.rate != null ? percent.format(result.rate) : '—'}</dd></div>
                </dl>
                {won ? <IconTrophy className={styles.trophy} size={20} aria-hidden="true" /> : null}
              </li>;
            })}
          </ol>
          {test.status === 'decided' ? test.learnedAt ? <p className={styles.learned}><IconCheck size={16} aria-hidden="true" /> {t.learned}</p>
            : canLearn ? <div className={styles.learn}><Button leading={<IconBulb size={16} />} disabled={pending} onClick={() => run({ type: 'learn', id: test.id, confirmation: `LEARN ${test.id}` }, t.learnConfirm, t.learned, t.learnFailed)}>{t.learn}</Button><span>{t.learnHint}</span></div> : null : null}
        </li>;
      })}
    </ul>}
    {dialog}
  </section>;
}
