'use client';
import { useInboxCatalog } from '../ui/copy-context';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/Button';
import { useConfirm } from '@/components/useConfirm';
import { MODERATION_ACTIONS, MODERATION_MATCHES, moderationConfirmation, moderationRuleProblem, moderationText, type ModerationLocale, type ModerationRuleInput } from '../moderation';
import styles from './ModerationRules.module.css';

type Rule = ModerationRuleInput & { id: string };
type LogRow = { id: string; ruleName: string; targetId: string; authorName: string | null; message: string; action: string; error: string | null; undoneAt: string | null; createdAt: string; undoable: boolean };
type Data = { rules: Rule[]; log: LogRow[]; channels: { id: string; name: string }[]; canTargetAllChannels: boolean };
const blank = (): ModerationRuleInput => ({ name: '', enabled: true, targetIds: [], match: 'links', keywords: [], action: 'hide', replyText: null, dailyCap: 20, oncePerUser: true });

export function ModerationRules({ canWrite, locale = 'en' }: { canWrite: boolean; locale?: ModerationLocale }) {
  const copy = useInboxCatalog('moderationCopy')[locale];
  const t = (key: Parameters<typeof moderationText>[1], values?: Record<string, string | number>) => (copy[key] as string).replace(/\{(\w+)\}/g, (whole, name: string) => values && name in values ? String(values[name]) : whole);
  const [data, setData] = useState<Data | null>(null);
  const [draft, setDraft] = useState<ModerationRuleInput | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [keywords, setKeywords] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const load = useCallback(async () => {
    const response = await fetch('/api/inbox/moderation', { cache: 'no-store' });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? t('loadFailed'));
    setData(body);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { let live = true; void load().catch(e => { if (live) setError(e instanceof Error ? e.message : t('loadFailed')); }); return () => { live = false; }; }, [load]);
  // Destructive or remote actions ask in the shared dialog (Cancel has initial focus); a declined ask sends nothing.
  const [confirmAsk, confirmDialog] = useConfirm({ title: t('confirmTitle'), cancel: t('cancel'), confirm: t('confirmGo') });
  async function act(body: Record<string, unknown>, ask?: string) {
    if (ask && !(await confirmAsk(ask))) return null;
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch('/api/inbox/moderation', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok || result.ok !== true) throw new Error(result.error ?? t('unconfirmed'));
      await load().catch(() => undefined);
      return result;
    } catch (e) { setError(e instanceof Error ? e.message : t('unconfirmed')); return null; }
    finally { setBusy(false); }
  }
  function startEdit(rule: Rule | null) {
    const value = rule ? { name: rule.name, enabled: rule.enabled, targetIds: rule.targetIds, match: rule.match, keywords: rule.keywords, action: rule.action, replyText: rule.replyText, dailyCap: rule.dailyCap, oncePerUser: rule.oncePerUser } : blank();
    if (!rule && !data?.canTargetAllChannels && data?.channels[0]) value.targetIds = [data.channels[0].id];
    setDraft(value); setEditing(rule?.id ?? null); setKeywords(value.keywords.join(', ')); setError(''); setNotice('');
  }
  async function save() {
    if (!draft) return;
    const rule = { ...draft, name: draft.name.trim(), keywords: keywords.split(',').map(word => word.trim()).filter(Boolean), replyText: draft.action === 'reply' ? (draft.replyText ?? '').trim() : null };
    const problem = moderationRuleProblem(rule);
    if (problem) { setError(t(problem === 'keywords' ? 'needsKeywords' : 'needsReply')); return; }
    const confirmation = editing ? moderationConfirmation.update(editing) : moderationConfirmation.create(rule.name);
    const result = await act(editing ? { action: 'rule.update', id: editing, rule, confirmation } : { action: 'rule.create', rule, confirmation });
    if (result) { setDraft(null); setEditing(null); setNotice(t('saved')); }
  }
  const channelName = (id: string) => data?.channels.find(channel => channel.id === id)?.name ?? id;
  return <div className={styles.root}>
    <section className={styles.panel} aria-labelledby="moderation-rules-heading">
      <div className={styles.row}><h2 id="moderation-rules-heading">{t('title')}</h2>
        {canWrite && data && !draft && <><Button size="sm" disabled={busy} onClick={() => startEdit(null)}>{t('addRule')}</Button>
          <Button size="sm" variant="quiet" disabled={busy || !data.rules.some(rule => rule.enabled)} onClick={async () => { const confirmation = moderationConfirmation.run(null); const result = await act({ action: 'rules.run', channelId: null, confirmation }, confirmation); if (result) setNotice(t('runDone', { examined: result.examined, acted: result.acted })); }}>{t('run')}</Button></>}
      </div>
      <p className={styles.hint}>{t('intro')}</p>
      {!data && !error && <p className={styles.meta} role="status">…</p>}
      {data && data.rules.length === 0 && !draft && <div><strong>{t('emptyTitle')}</strong><p className={styles.hint}>{t('emptyHint')}</p></div>}
      {data && data.rules.length > 0 && <ul className={styles.list}>{data.rules.map(rule => <li key={rule.id} className={styles.item}>
        <strong>{rule.name}{rule.enabled ? '' : ` · ${t('paused')}`}</strong>
        <span className={styles.meta}>{t(`action.${rule.action}` as 'action.hide')} · {t('when')} {t(`match.${rule.match}` as 'match.links')}{rule.match === 'keywords' ? `: ${rule.keywords.join(', ')}` : ''} · {rule.targetIds.length ? rule.targetIds.map(channelName).join(', ') : t('allChannels')} · {t('dailyCap')}: {rule.dailyCap}</span>
        {canWrite && <div className={styles.row}>
          <Button size="sm" variant="quiet" disabled={busy || Boolean(draft)} onClick={() => startEdit(rule)}>{t('edit')}</Button>
          <Button size="sm" variant="quiet" disabled={busy} onClick={() => void act({ action: 'rule.update', id: rule.id, rule: { name: rule.name, enabled: !rule.enabled, targetIds: rule.targetIds, match: rule.match, keywords: rule.keywords, action: rule.action, replyText: rule.replyText, dailyCap: rule.dailyCap, oncePerUser: rule.oncePerUser }, confirmation: moderationConfirmation.update(rule.id) })}>{rule.enabled ? t('pause') : t('resume')}</Button>
          <Button size="sm" variant="quiet" disabled={busy} onClick={() => void act({ action: 'rule.delete', id: rule.id, confirmation: moderationConfirmation.remove(rule.id) }, t('deleteConfirm'))}>{t('remove')}</Button>
        </div>}
      </li>)}</ul>}
      {draft && data && <form className={styles.form} aria-label={t('title')} onSubmit={event => { event.preventDefault(); void save(); }}>
        <label>{t('name')}<input type="text" required maxLength={120} value={draft.name} placeholder={t('namePlaceholder')} onChange={e => setDraft({ ...draft, name: e.target.value })} /></label>
        <label>{t('when')}<select value={draft.match} onChange={e => setDraft({ ...draft, match: e.target.value as ModerationRuleInput['match'] })}>{MODERATION_MATCHES.map(match => <option key={match} value={match}>{t(`match.${match}`)}</option>)}</select></label>
        {draft.match === 'keywords' && <label>{t('keywords')}<input type="text" value={keywords} onChange={e => setKeywords(e.target.value)} /><span className={styles.hint}>{t('keywordsHint')}</span></label>}
        <label>{t('then')}<select value={draft.action} onChange={e => setDraft({ ...draft, action: e.target.value as ModerationRuleInput['action'] })}>{MODERATION_ACTIONS.map(action => <option key={action} value={action}>{t(`action.${action}`)}</option>)}</select></label>
        {draft.action === 'reply' && <><label>{t('replyText')}<textarea maxLength={2000} value={draft.replyText ?? ''} onChange={e => setDraft({ ...draft, replyText: e.target.value })} /><span className={styles.hint}>{t('replyHint')}</span></label>
          <label className={styles.check}><input type="checkbox" checked={draft.oncePerUser} onChange={e => setDraft({ ...draft, oncePerUser: e.target.checked })} />{t('oncePerUser')}</label></>}
        <fieldset className={styles.channels}><legend>{t('channels')}</legend>
          {data.canTargetAllChannels && <label className={styles.check}><input type="checkbox" checked={draft.targetIds.length === 0} onChange={e => setDraft({ ...draft, targetIds: e.target.checked ? [] : data.channels.slice(0, 1).map(channel => channel.id) })} />{t('allChannels')}</label>}
          {(draft.targetIds.length > 0 || !data.canTargetAllChannels) && data.channels.map(channel => <label key={channel.id} className={styles.check}><input type="checkbox" checked={draft.targetIds.includes(channel.id)} onChange={e => setDraft({ ...draft, targetIds: e.target.checked ? [...draft.targetIds, channel.id] : draft.targetIds.filter(id => id !== channel.id) })} />{channel.name}</label>)}
        </fieldset>
        <label>{t('dailyCap')}<input type="number" min={1} max={500} value={draft.dailyCap} onChange={e => setDraft({ ...draft, dailyCap: Math.max(1, Math.min(500, Number(e.target.value) || 1)) })} /><span className={styles.hint}>{t('dailyCapHint')}</span></label>
        <div className={styles.row}><Button type="submit" disabled={busy || !draft.name.trim() || (!data.canTargetAllChannels && draft.targetIds.length === 0)}>{t('saveRule')}</Button><Button variant="quiet" disabled={busy} onClick={() => { setDraft(null); setEditing(null); }}>{t('cancel')}</Button></div>
      </form>}
      {error && <p className={styles.error} role="alert">{error}</p>}
      {notice && <p className={styles.success} role="status">{notice}</p>}
    </section>
    <section className={styles.panel} aria-labelledby="moderation-log-heading">
      <h2 id="moderation-log-heading">{t('logHeading')}</h2>
      <p className={styles.hint}>{t('logHint')}</p>
      {data && data.log.length === 0 && <div><strong>{t('logEmptyTitle')}</strong><p className={styles.hint}>{t('logEmptyHint')}</p></div>}
      {data && data.log.length > 0 && <ul className={styles.list}>{data.log.map(row => <li key={row.id} className={styles.item}>
        <span className={styles.meta}>{new Date(row.createdAt).toLocaleString(locale)} · {channelName(row.targetId)} · {row.ruleName}</span>
        <span><strong>{row.authorName || t('someone')}</strong>: {row.message}</span>
        <span className={styles.meta}>{row.error ? t('failed', { reason: row.error }) : row.undoneAt ? t('undone') : t(`done.${row.action}` as 'done.hide')}</span>
        {canWrite && row.undoable && <div><Button size="sm" variant="quiet" disabled={busy} onClick={async () => { const result = await act({ action: 'action.undo', id: row.id, confirmation: moderationConfirmation.undo(row.id) }, t('undoHideConfirm')); if (result) setNotice(t('undoneOk')); }}>{t('undoHide')}</Button></div>}
      </li>)}</ul>}
    </section>
    {confirmDialog}
  </div>;
}
