'use client';

import { useRef, useState } from 'react';
import { Button } from '@/components/Button';
import { Dialog } from '@/components/Dialog';
import { RouteNotice } from '@/components/RouteNotice';
import { recipeCopy, recipeText, type RecipeCopyCatalog, type RecipeCopyKey, type RecipeLocale } from '../copy-recipes';
import { configPatch } from '../wordpress/recipe';
import styles from './feeds.module.css';
import { RecipeSupplyWarning } from './RecipeSupplyWarning';

type Mapping = { captionMetaKey: string; imageMetaKey: string; recipeMetaKey: string; skipMetaKey: string; attachedFileMetaKey: string; postType: string; postStatus: string };
export type RecipeConfig = {
  mapping: Mapping; order: 'newest' | 'oldest'; maxAgeDays: number; skipShared: boolean; slots: string[]; timezone: string; horizonDays: number;
  distinctAcrossPages: boolean; cooldownDays: number; firstCommentTemplate: string; firstCommentDelayMinutes: number;
};
export type RecipeSourceData = {
  id: string; name: string; siteUrl: string; hasCredential: boolean; enabled: boolean; allTargets: boolean; targetIds: string[]; config: RecipeConfig;
  lastRunAt: string | null; lastError: string | null; lastSummary: { planned?: number; failed?: number; unfilled?: number; scanned?: number; candidates?: number; rejected?: { shared: number; caption: number; image: number; link: number; recipe: number } } | null;
};
export type RecipePlan = { id: string; targetId: string; targetName: string; wpPostId: string; slotAt: string; state: 'claimed' | 'planned' | 'uncertain' | 'failed'; postId: string | null; title: string; permalink: string | null; reason: string | null };
export type RecipeView = {
  source: RecipeSourceData | null; defaults: RecipeConfig & { siteUrl: string }; pages: Array<{ id: string; name: string }>; plans: { items: RecipePlan[]; page: number; hasMore: boolean };
  counts: Record<string, number>; available: boolean; limits: { maxNameCharacters: number; maxTemplateCharacters: number; pauseCancel?: boolean };
  reuse?: { enabled: boolean; cooldownDays: number };
  pool?: RecipePool | null;
  /** Times formatted on the server in the source's zone; the browser never formats a zoned instant. */
  labels?: { lastRun: string | null; poolAsOf: string | null; slots: Record<string, string> };
};
export type RecipePool = { asOf: string; complete: boolean; warnDays: number; low: boolean; pages: Array<{ targetId: string; targetName: string; eligible: number; daysLeft: number | null; low: boolean }> };
type Preview = { items: Array<{ wpPostId: string; title: string; permalink: string; imageUrl: string; caption: string; firstComment: string }> };
type Review = 'save' | 'pause' | 'resume' | 'run' | 'retry';
const PAUSE_PHRASE = 'PAUSE RECIPE SOURCE';
const PAUSE_CANCEL_PHRASE = 'PAUSE RECIPE SOURCE AND CANCEL SCHEDULED POSTS';
const REVIEW_COPY: Record<Review, { title: RecipeCopyKey; text: RecipeCopyKey; action: RecipeCopyKey }> = {
  save: { title: 'saveTitle', text: 'saveDescription', action: 'confirmSave' }, pause: { title: 'pauseTitle', text: 'pauseDescription', action: 'confirmPause' },
  resume: { title: 'resumeTitle', text: 'resumeDescription', action: 'confirmResume' }, run: { title: 'runTitle', text: 'runDescription', action: 'confirmRun' },
  retry: { title: 'retryTitle', text: 'retryDescription', action: 'confirmRetry' },
};
type Draft = { name: string; siteUrl: string; credential: string; allTargets: boolean; targetIds: string[]; config: RecipeConfig };

const SLOT = /^([01]\d|2[0-3]):[0-5]\d$/;
const defaultConfig = (defaults: RecipeView['defaults']): RecipeConfig => { const { siteUrl: _siteUrl, ...config } = defaults; return structuredClone(config); };
const initialDraft = (view: RecipeView): Draft => view.source
  ? { name: view.source.name, siteUrl: view.source.siteUrl, credential: '', allTargets: view.source.allTargets, targetIds: view.source.targetIds, config: structuredClone(view.source.config) }
  : { name: '', siteUrl: view.defaults.siteUrl, credential: '', allTargets: true, targetIds: [], config: defaultConfig(view.defaults) };

export function RecipeSource({ initial, locale, canWrite, copy = recipeCopy }: { initial: RecipeView; locale: RecipeLocale; canWrite: boolean; copy?: RecipeCopyCatalog }) {
  const t = (key: RecipeCopyKey, values: Record<string, string | number> = {}) => recipeText(locale, key, values, copy);
  const [view, setView] = useState(initial);
  const [draft, setDraft] = useState(() => initialDraft(initial));
  const [review, setReview] = useState<Review | null>(null);
  const [confirmation, setConfirmation] = useState('');
  const [cancelPosts, setCancelPosts] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ error: boolean; text: string; key: number } | null>(null);
  const inFlight = useRef(false);
  const source = view.source;
  const say = (text: string, error = false) => setNotice(v => ({ error, text, key: (v?.key ?? 0) + 1 }));
  const errorText = (body: unknown) => body && typeof body === 'object' && 'error' in body && typeof (body as { error: unknown }).error === 'string' ? (body as { error: string }).error : t('unknownError');
  const phrase = review === 'save' ? `SAVE RECIPE SOURCE ${draft.name.trim()}` : review === 'pause' ? (cancelPosts ? PAUSE_CANCEL_PHRASE : PAUSE_PHRASE) : review === 'resume' ? 'RESUME RECIPE SOURCE' : review === 'retry' ? 'RETRY RECIPE SLOTS' : 'RUN RECIPE PLANNER';
  const confirmParts = copy[locale].typeToConfirm.split('{phrase}');
  const setConfig = (patch: Partial<RecipeConfig>) => setDraft(d => ({ ...d, config: { ...d.config, ...patch } }));
  const setMapping = (patch: Partial<Mapping>) => setDraft(d => ({ ...d, config: { ...d.config, mapping: { ...d.config.mapping, ...patch } } }));

  async function call(url: string, method: string, payload?: unknown) {
    const response = await fetch(url, { method, headers: { 'content-type': 'application/json' }, ...(payload === undefined ? {} : { body: JSON.stringify(payload) }) });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(errorText(body));
    return body;
  }
  async function run(task: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setNotice(null);
    try { await task(); } catch (error) { say(error instanceof Error && !(error instanceof TypeError) ? error.message : t('unknownError'), true); }
    finally { setBusy(false); inFlight.current = false; }
  }
  async function reload() {
    const body = await call('/api/feeds/wordpress', 'GET');
    if (body && typeof body === 'object' && 'plans' in body) { setView(body as RecipeView); setDraft(initialDraft(body as RecipeView)); }
  }
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!draft.name.trim() || !draft.siteUrl.trim()) { say(t('enterRequired'), true); return; }
    if (!draft.allTargets && !draft.targetIds.length) { say(t('chooseOne'), true); return; }
    if (draft.config.slots.some(s => !SLOT.test(s))) { say(t('slotInvalid'), true); return; }
    setConfirmation(''); setReview('save');
  };
  const perform = () => run(async () => {
    if (review === 'save') {
      await call('/api/feeds/wordpress', 'PUT', { name: draft.name.trim(), siteUrl: draft.siteUrl.trim(), ...(draft.credential.trim() ? { credential: draft.credential.trim() } : {}), allTargets: draft.allTargets, targetIds: draft.allTargets ? [] : draft.targetIds, config: configPatch(draft.config, view.defaults), confirmation: phrase });
      await reload(); say(t('savedNotice'));
    } else if (review === 'pause' || review === 'resume') {
      const body = await call('/api/feeds/wordpress/state', 'POST', { enabled: review === 'resume', ...(review === 'pause' && cancelPosts ? { cancelScheduled: true } : {}), confirmation: phrase }) as { cancellation?: { cancelled: number; notCancelled: number; remaining: boolean; incomplete: boolean } };
      await reload();
      const c = body?.cancellation;
      say(!c ? t(review === 'resume' ? 'resumedNotice' : 'pausedNotice') : c.incomplete ? t('pauseCancelIncomplete') : `${t('pauseCancelNotice', { cancelled: c.cancelled, notCancelled: c.notCancelled })}${c.remaining ? ` ${t('pauseCancelMore')}` : ''}`, Boolean(c?.incomplete));
    } else if (review === 'retry') {
      const body = await call('/api/feeds/wordpress/retry', 'POST', { confirmation: phrase }) as { planned: number; reconciled: number; unconfirmed: number; failed: number };
      await reload(); say(t('retryNotice', { planned: body.planned, reconciled: body.reconciled, unconfirmed: body.unconfirmed, failed: body.failed }));
    } else if (review === 'run') {
      const body = await call('/api/feeds/wordpress/run', 'POST', { confirmation: phrase }) as { planned: number; failed: number; unfilled: number };
      await reload(); say(t('runNotice', { planned: body.planned, failed: body.failed, unfilled: body.unfilled }));
    }
    setReview(null);
  });
  const loadPreview = () => run(async () => { const body = await call('/api/feeds/wordpress/preview', 'POST', {}); if (!body || !Array.isArray(body.items)) throw new Error(t('unknownError')); setPreview(body as Preview); });
  const goPage = (page: number) => run(async () => { const body = await call(`/api/feeds/wordpress?page=${page}`, 'GET'); if (body && 'plans' in body) setView(v => ({ ...v, plans: body.plans, counts: body.counts })); });
  const toggle = (id: string) => setDraft(d => ({ ...d, targetIds: d.targetIds.includes(id) ? d.targetIds.filter(x => x !== id) : [...d.targetIds, id] }));
  const stateText = (p: RecipePlan) => t(p.state === 'planned' ? 'statePlanned' : p.state === 'claimed' ? 'stateClaimed' : p.state === 'uncertain' ? 'stateUncertain' : 'stateFailed');
  const reasonText = (reason: string | null) => { const key = reason ? `reason${reason.charAt(0).toUpperCase()}${reason.slice(1)}` : ''; return key in copy[locale] ? t(key as RecipeCopyKey) : ''; };
  const reviewTitle = review ? t(REVIEW_COPY[review].title) : '';
  const reviewText = review ? t(review === 'pause' && cancelPosts ? 'pauseCancelDescription' : REVIEW_COPY[review].text) : '';
  const reviewAction = review ? t(REVIEW_COPY[review].action) : '';
  const unresolved = (view.counts['failed'] ?? 0) + (view.counts['uncertain'] ?? 0);
  const openReview = (next: Review) => { setConfirmation(''); setCancelPosts(false); setReview(next); };
  const lastRun = source?.lastRunAt ? t('lastRun', { when: view.labels?.lastRun ?? '', planned: source.lastSummary?.planned ?? 0, failed: source.lastSummary?.failed ?? 0, unfilled: source.lastSummary?.unfilled ?? 0 }) : t('neverRun');
  // When slots stay empty, say why: which recipes were read and why the others could not be used.
  const summary = source?.lastSummary;
  const unfilledWhy = summary?.unfilled && summary.rejected && summary.candidates !== undefined
    ? t('unfilledWhy', { scanned: summary.scanned ?? 0, candidates: summary.candidates, shared: summary.rejected.shared, caption: summary.rejected.caption, image: summary.rejected.image + summary.rejected.link, recipe: summary.rejected.recipe }) : null;
  const statusKey: RecipeCopyKey = !source ? 'statusNew' : source.enabled ? 'statusActive' : 'statusPaused';

  return <section className={styles.root} aria-labelledby="recipe-heading">
    <h2 id="recipe-heading" className={styles.sectionTitle}>{t('title')}</h2>
    <p className={styles.help}>{t('intro')}</p>
    {!view.available && <p className={styles.help} role="status">{t('unavailable')}</p>}
    {notice && !review && <RouteNotice error={notice.error} focusKey={`recipe-notice:${notice.key}`}>{notice.text}</RouteNotice>}
    <p className={styles.help}><span className={styles.badge}>{t(statusKey)}</span> {lastRun}{source?.lastError && <span className={styles.meta}>{source.lastError}</span>}</p>
    {unfilledWhy ? <p className={styles.help}>{unfilledWhy}</p> : null}
    {canWrite && source && <div className={styles.actions}>
      <Button disabled={busy} onClick={() => void loadPreview()}>{busy ? t('previewing') : t('preview')}</Button>
      <Button disabled={busy || !source.enabled || !view.available} onClick={() => openReview('run')}>{t('run')}</Button>
      {unresolved > 0 && <Button disabled={busy || !source.enabled || !view.available} onClick={() => openReview('retry')}>{t('retry')}</Button>}
      <Button disabled={busy} onClick={() => openReview(source.enabled ? 'pause' : 'resume')}>{t(source.enabled ? 'pause' : 'resume')}</Button>
    </div>}

    {source && view.pool !== undefined && <div aria-live="polite">
      <h3 className={styles.sectionTitle}>{t('poolHeading')}</h3>
      {view.pool ? <>
        <RecipeSupplyWarning pool={view.pool} locale={locale} copy={copy} />
        {view.reuse && <p className={styles.help}>{t(view.reuse.enabled ? 'poolReuseEnabled' : 'poolReuseDisabled', { days: view.reuse.cooldownDays })}</p>}
        <p className={styles.help}>{t('poolIntro')} {!view.pool.complete && t('poolPartial')} {t('poolAsOf', { when: view.labels?.poolAsOf ?? '' })}</p>
        <div className={styles.tableWrap}><table className={styles.table}><caption className="sr-only">{t('poolHeading')}</caption>
          <thead><tr><th scope="col">{t('colChannel')}</th><th scope="col">{t('colEligible')}</th><th scope="col">{t('colDays')}</th></tr></thead>
          <tbody>{view.pool.pages.map(p => <tr key={p.targetId}><th scope="row">{p.targetName}</th><td>{p.eligible}</td><td>{p.daysLeft === null ? t('daysUnlimited') : p.daysLeft}{p.low && <span className={styles.meta}>{t('poolRowLow')}</span>}</td></tr>)}</tbody>
        </table></div>
      </> : <p className={styles.help}>{t('poolUnknown')}</p>}
    </div>}

    {preview && <div aria-live="polite"><h3 className={styles.sectionTitle}>{t('previewTitle')}</h3>
      {preview.items.length ? <ul className={styles.recipes}>{preview.items.map(item => <li key={item.wpPostId} className={styles.recipe}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className={styles.thumb} src={item.imageUrl} alt={t('previewImage', { title: item.title })} loading="lazy" width={160} height={160} />
        <div><strong>{item.title}</strong> <a href={item.permalink} target="_blank" rel="noopener noreferrer">{t('previewLink')}</a>
          <span className={styles.meta}>{t('previewCaption')}</span><p className={styles.reviewPreview}>{item.caption}</p>
          <span className={styles.meta}>{t('previewComment')}</span><p className={styles.reviewPreview}>{item.firstComment}</p></div>
      </li>)}</ul> : <p className={styles.empty}>{t('previewEmpty')}</p>}
    </div>}
    {!preview && source && <p className={styles.help}>{t('previewNone')}</p>}

    {canWrite && <form className={styles.form} onSubmit={submit} noValidate aria-label={t('sourceHeading')}>
      <h3 className={styles.sectionTitle}>{t('sourceHeading')}</h3>
      <label>{t('name')}<input disabled={busy} required maxLength={view.limits.maxNameCharacters} value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} /></label>
      <label>{t('siteUrl')}<input disabled={busy} required inputMode="url" placeholder="https://" value={draft.siteUrl} onChange={e => setDraft(d => ({ ...d, siteUrl: e.target.value }))} /><span>{t('siteUrlHint')}</span></label>
      <label>{t('credential')}<input disabled={busy} type="password" autoComplete="off" placeholder={view.source?.hasCredential ? t('credentialSaved') : 'username:xxxx xxxx xxxx xxxx'} value={draft.credential} onChange={e => setDraft(d => ({ ...d, credential: e.target.value }))} /><span>{t('credentialHint')}</span></label>
      <fieldset className={styles.checks} disabled={busy}><legend>{t('channels')}</legend>
        <label><input type="radio" name="recipe-scope" checked={draft.allTargets} onChange={() => setDraft(d => ({ ...d, allTargets: true }))} />{t('allChannels')}</label>
        <label><input type="radio" name="recipe-scope" checked={!draft.allTargets} onChange={() => setDraft(d => ({ ...d, allTargets: false }))} />{t('chooseChannels')}</label>
        {!draft.allTargets && (view.pages.length ? view.pages.map(p => <label key={p.id}><input type="checkbox" checked={draft.targetIds.includes(p.id)} onChange={() => toggle(p.id)} />{p.name}</label>) : <span className={styles.help}>{t('noChannels')}</span>)}
      </fieldset>

      <h3 className={styles.sectionTitle}>{t('timingHeading')}</h3>
      <fieldset className={styles.checks} disabled={busy}><legend>{t('slots')}</legend>
        {draft.config.slots.map((slot, index) => <div key={index} className={styles.slotRow}>
          <input type="time" aria-label={t('slots')} value={slot} onChange={e => setConfig({ slots: draft.config.slots.map((s, i) => i === index ? e.target.value : s) })} />
          <Button size="sm" type="button" disabled={draft.config.slots.length < 2} onClick={() => setConfig({ slots: draft.config.slots.filter((_, i) => i !== index) })}>{t('removeSlot', { time: slot })}</Button>
        </div>)}
        <Button size="sm" type="button" onClick={() => setConfig({ slots: [...draft.config.slots, '12:00'] })}>{t('addSlot')}</Button>
      </fieldset>
      <label>{t('timezone')}<input disabled={busy} value={draft.config.timezone} onChange={e => setConfig({ timezone: e.target.value })} /><span>{t('timezoneHint')}</span></label>
      <label>{t('horizon')}<input disabled={busy} type="number" min={1} max={14} step={1} value={draft.config.horizonDays} onChange={e => setConfig({ horizonDays: Math.trunc(Number(e.target.value)) || 1 })} /></label>
      <label className={styles.inline}><input type="checkbox" disabled={busy} checked={draft.config.distinctAcrossPages} onChange={e => setConfig({ distinctAcrossPages: e.target.checked })} /> {t('distinct')}</label>
      <span className={styles.help}>{t('distinctHint')}</span>
      <label>{t('cooldown')}<input disabled={busy} type="number" min={0} step={1} value={draft.config.cooldownDays} onChange={e => setConfig({ cooldownDays: Math.max(0, Math.trunc(Number(e.target.value)) || 0) })} /></label>

      <h3 className={styles.sectionTitle}>{t('selectionHeading')}</h3>
      <label className={styles.inline}><input type="checkbox" disabled={busy} checked={draft.config.skipShared} onChange={e => setConfig({ skipShared: e.target.checked })} /> {t('skipShared')}</label>
      <label>{t('order')}<select disabled={busy} value={draft.config.order} onChange={e => setConfig({ order: e.target.value === 'oldest' ? 'oldest' : 'newest' })}><option value="newest">{t('orderNewest')}</option><option value="oldest">{t('orderOldest')}</option></select></label>
      <label>{t('maxAge')}<input disabled={busy} type="number" min={0} step={1} value={draft.config.maxAgeDays} onChange={e => setConfig({ maxAgeDays: Math.max(0, Math.trunc(Number(e.target.value)) || 0) })} /></label>

      <h3 className={styles.sectionTitle}>{t('commentHeading')}</h3>
      <label>{t('template')}<textarea disabled={busy} rows={9} maxLength={view.limits.maxTemplateCharacters} value={draft.config.firstCommentTemplate} onChange={e => setConfig({ firstCommentTemplate: e.target.value })} /><span>{t('templateHint')}</span></label>
      <label>{t('delay')}<input disabled={busy} type="number" min={0} step={1} value={draft.config.firstCommentDelayMinutes} onChange={e => setConfig({ firstCommentDelayMinutes: Math.max(0, Math.trunc(Number(e.target.value)) || 0) })} /></label>

      <details><summary>{t('mappingHeading')}</summary><div className={styles.form}>
        {([['captionKey', 'captionMetaKey'], ['imageKey', 'imageMetaKey'], ['recipeKey', 'recipeMetaKey'], ['skipKey', 'skipMetaKey'], ['attachedKey', 'attachedFileMetaKey'], ['postType', 'postType'], ['postStatus', 'postStatus']] as const).map(([label, field]) =>
          <label key={field}>{t(label)}<input disabled={busy} value={draft.config.mapping[field]} onChange={e => setMapping({ [field]: e.target.value })} /></label>)}
      </div></details>

      <div className={styles.actions}>
        <Button type="submit" variant="primary" disabled={busy}>{busy ? t('saving') : t('save')}</Button>
        <Button type="button" disabled={busy} onClick={() => setDraft(d => ({ ...d, config: defaultConfig(view.defaults) }))}>{t('reset')}</Button>
      </div>
    </form>}

    <h3 className={styles.sectionTitle}>{t('plansHeading')}</h3>
    {view.plans.items.length ? <div className={styles.tableWrap}><table className={styles.table}><caption className="sr-only">{t('plansHeading')}</caption>
      <thead><tr><th scope="col">{t('colTime')}</th><th scope="col">{t('colChannel')}</th><th scope="col">{t('colRecipe')}</th><th scope="col">{t('colState')}</th></tr></thead>
      <tbody>{view.plans.items.map(p => <tr key={p.id}><th scope="row">{view.labels?.slots[p.id] ?? ''}</th><td>{p.targetName}</td><td>{p.title}</td><td>{stateText(p)}{reasonText(p.reason) && <span className={styles.meta}>{reasonText(p.reason)}</span>}</td></tr>)}</tbody>
    </table></div> : <p className={styles.empty}>{t('plansEmpty')}</p>}
    <nav className={styles.pagination} aria-label={t('plansHeading')}>
      {view.plans.page > 1 ? <Button size="sm" disabled={busy} onClick={() => void goPage(view.plans.page - 1)}>{t('previous')}</Button> : <span />}
      <span>{t('pageLabel', { page: view.plans.page })}</span>
      {view.plans.hasMore ? <Button size="sm" disabled={busy} onClick={() => void goPage(view.plans.page + 1)}>{t('next')}</Button> : <span />}
    </nav>

    <Dialog open={Boolean(review)} title={reviewTitle} description={reviewText} onClose={() => !busy && setReview(null)} busy={busy}
      actions={<><Button data-dialog-cancel disabled={busy} onClick={() => setReview(null)}>{t('cancel')}</Button><Button variant="primary" disabled={busy || !review || confirmation !== phrase} onClick={() => void perform()}>{reviewAction}</Button></>}>
      {notice?.error && <RouteNotice error focusKey={`recipe-review-error:${notice.key}`}>{notice.text}</RouteNotice>}
      {review === 'pause' && view.limits.pauseCancel && <label className={styles.inline}><input type="checkbox" disabled={busy} checked={cancelPosts} onChange={e => { setCancelPosts(e.target.checked); setConfirmation(''); }} /> {t('pauseCancelOption')}<span className={styles.help}>{t('pauseCancelHint')}</span></label>}
      {review && <label className={styles.confirmLabel}>{confirmParts[0]}<code>{phrase}</code>{confirmParts[1]}<input autoComplete="off" value={confirmation} onChange={e => setConfirmation(e.target.value)} /></label>}
    </Dialog>
  </section>;
}
