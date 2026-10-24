'use client';

import { useState } from 'react';
import { Button } from '@/components/Button';
import { mixAutoFillConfirmation, saveMixConfirmation } from '@/modules/publishing/collaboration/schemas';
import { ConfirmDialog, send, useAction } from './collab-client';
import styles from './collaboration.module.css';
import { useCollaborationCopy } from '../compose/CopyProvider';
import { fillComposerCopy } from '../../composer-catalog';

type Rule = { labelId: string; perWeek: number | '' };
type StoredRule = { labelId: string; perWeek: number; id: string; targetId: string | null; groupId: string | null; ranDry: boolean };
type Line = { labelId: string; perWeek: number; planned: number; readyDrafts: number };
const keyFor = (key: string) => key || 'none';

export function ContentMix({ targets, groups, labels, rules, status, windowDays, maxPerWeek, mixAutoFill, canEditChannels, canEditGroups, canEditAutoFill }: { targets: Array<{ id: string; name: string }>; groups: Array<{ id: string; name: string }>; labels: Array<{ id: string; name: string }>; rules: StoredRule[]; status: Array<{ targetId: string; lines: Line[] }>; windowDays: number; maxPerWeek: number; mixAutoFill: boolean; canEditChannels: boolean; canEditGroups: boolean; canEditAutoFill: boolean }) {
  const c = useCollaborationCopy();
  const [stored, setStored] = useState(rules);
  const [scopeKey, setScopeKey] = useState('');
  const [drafts, setDrafts] = useState<Record<string, Rule[]>>({});
  const [review, setReview] = useState(false);
  const [autoFillReview, setAutoFillReview] = useState(false);
  const [autoFillEnabled, setAutoFillEnabled] = useState(mixAutoFill);
  const [autoFillDesired, setAutoFillDesired] = useState(mixAutoFill);
  const action = useAction();
  const scope = scopeKey.startsWith('t:') ? { targetId: scopeKey.slice(2) } : scopeKey.startsWith('g:') ? { groupId: scopeKey.slice(2) } : null;
  const canEdit = scope && ('targetId' in scope ? canEditChannels : canEditGroups);
  const own = scope ? stored.filter(r => ('targetId' in scope ? r.targetId === scope.targetId : r.groupId === scope.groupId)) : [];
  const draftKey = keyFor(scopeKey);
  const rows: Rule[] = drafts[draftKey] ?? own.map(({ labelId, perWeek }) => ({ labelId, perWeek }));
  const name = (id: string) => labels.find(l => l.id === id)?.name ?? c.removed_label;
  const free = labels.filter(l => !rows.some(r => r.labelId === l.id));
  const confirmation = scope ? saveMixConfirmation(scope) : '';
  const planned = status.filter(s => targets.some(t => t.id === s.targetId));
  const invalidRows = rows.filter(r => typeof r.perWeek !== 'number' || !Number.isInteger(r.perWeek) || r.perWeek < 1 || r.perWeek > maxPerWeek);
  const setRows = (next: Rule[]) => setDrafts(current => ({ ...current, [draftKey]: next }));
  const discard = () => setDrafts(current => { const next = { ...current }; delete next[draftKey]; return next; });

  async function save() {
    if (!scope || invalidRows.length) return;
    const savedScope = scope;
    const savedKey = draftKey;
    const savedRows = rows as Array<{ labelId: string; perWeek: number }>;
    const ok = await action.run(async () => {
      const result = await action.send<{ rules: number }>('PUT', '/api/publishing/content-mix', { scope: savedScope, rules: savedRows, confirmation: saveMixConfirmation(savedScope) });
      if (result.rules !== savedRows.length) throw new Error(c.the_saved_rules_could_not_be_verified_refresh_to_see_the_current);
      setStored(current => [...current.filter(r => !('targetId' in savedScope ? r.targetId === savedScope.targetId : r.groupId === savedScope.groupId)), ...savedRows.map(r => ({ ...r, id: `${savedKey}:${r.labelId}`, targetId: 'targetId' in savedScope ? savedScope.targetId ?? null : null, groupId: 'groupId' in savedScope ? savedScope.groupId ?? null : null, ranDry: false }))]);
      setDrafts(current => { const next = { ...current }; delete next[savedKey]; return next; });
      return c.content_mix_saved;
    });
    if (ok) setReview(false);
  }

  async function saveAutoFill() {
    const desired = autoFillDesired;
    const ok = await action.run(async () => {
      const result = await action.send<{ enabled: boolean }>('PUT', '/api/publishing/content-mix', { action: 'setAutoFill', enabled: desired, confirmation: mixAutoFillConfirmation(desired) });
      if (result.enabled !== desired) throw new Error(c.the_setting_could_not_be_verified_refresh_to_check_its_current_state);
      setAutoFillEnabled(desired);
      return desired ? c.automatic_content_mix_scheduling_is_on : c.automatic_content_mix_scheduling_is_off;
    });
    if (ok) setAutoFillReview(false);
  }

  return <div className={styles.root}>
    <>
      <section className={styles.section} aria-label={c.content_mix_controls}>
        <h2>{c.content_mix}</h2>
        <label className={styles.form}><span className={styles.meta}>{c.edit_a_channel_or_group}</span><select value={scopeKey} onChange={e => setScopeKey(e.target.value)} disabled={action.busy}><option value="">{c.choose}</option>
          <optgroup label={c.channels}>{targets.map(t => <option key={t.id} value={`t:${t.id}`}>{t.name}{drafts[keyFor(`t:${t.id}`)] ? c.unsaved_changes : ''}</option>)}</optgroup>{groups.length > 0 && <optgroup label={c.groups}>{groups.map(g => <option key={g.id} value={`g:${g.id}`}>{g.name}{drafts[keyFor(`g:${g.id}`)] ? c.unsaved_changes : ''}</option>)}</optgroup>}</select></label>
        <p className={styles.help}>{fillComposerCopy(c.mixWindow, { days: windowDays })}</p>
      </section>
      <section className={styles.section} aria-label={c.automatic_content_mix_scheduling}>
        <h2>{c.automatic_scheduling}</h2>
        <p className={styles.help}>{autoFillEnabled ? c.when_enabled_the_scheduler_can_add_eligible_drafts_to_fill_unmet_content : c.off_saving_mix_rules_alone_never_schedules_posts}</p>
        {canEditAutoFill ? <>
          <label className={styles.check}><input type="checkbox" checked={autoFillDesired} disabled={action.busy} onChange={e => setAutoFillDesired(e.target.checked)} />{c.enable_automatic_scheduling}</label>
          {autoFillDesired !== autoFillEnabled && <div className={styles.actions}><Button variant="primary" disabled={action.busy} onClick={() => setAutoFillReview(true)}>{c.review_setting}</Button><Button disabled={action.busy} onClick={() => setAutoFillDesired(autoFillEnabled)}>{c.discard}</Button></div>}
        </> : <p className={styles.help}>{c.only_workspace_owners_and_admins_with_access_to_all_channels_can_change_2}</p>}
      </section>
    </>
    {action.banner}
    <section className={styles.section}><h2>{c.planned_posts}</h2>
      <p className={styles.help}>{c.counts_include_only_posts_whose_full_destination_set_is_visible_to_you}</p>
      {planned.length ? <div className={styles.tableWrap}><table className={styles.table}><caption className="sr-only">{c.planned_posts_against_the_content_mix}</caption><thead><tr><th scope="col">{c.channel}</th><th scope="col">{c.label}</th><th scope="col">{c.planned}</th><th scope="col">{c.target}</th><th scope="col">{c.ready_drafts}</th></tr></thead>
        <tbody>{planned.flatMap(s => s.lines.map(l => <tr key={`${s.targetId}:${l.labelId}`}><th scope="row">{targets.find(t => t.id === s.targetId)?.name}</th><td>{name(l.labelId)}</td><td>{l.planned}{l.planned < l.perWeek ? c.short : ''}</td><td>{l.perWeek}</td><td>{l.readyDrafts}</td></tr>))}</tbody></table></div>
        : <p className={styles.empty}>{c.no_content_mix_is_set_up_yet}</p>}
    </section>
    <section className={styles.section}><h2>{scope ? fillComposerCopy(c.rulesFor, { name: 'groupId' in scope ? groups.find(g => g.id === scope.groupId)?.name ?? c.group : targets.find(t => t.id === scope.targetId)?.name ?? c.channel_2 }) : c.edit_mix_rules}</h2>
      {scope ? <>
        {rows.length ? <ul className={styles.form}>{rows.map((r, index) => <li key={r.labelId} className={styles.slotRow}><span>{name(r.labelId)}</span>
          <label><span className="sr-only">{fillComposerCopy(c.postsPerWeek, { label: name(r.labelId) })}</span><input type="number" min={1} max={maxPerWeek} step={1} value={r.perWeek} disabled={!canEdit || action.busy} aria-invalid={r.perWeek === '' || invalidRows.includes(r)} aria-describedby={r.perWeek === '' || invalidRows.includes(r) ? `mix-rule-error-${index}` : undefined} onChange={e => setRows(rows.map(x => x.labelId === r.labelId ? { ...x, perWeek: e.target.value === '' ? '' : Number(e.target.value) } : x))} />{c.perWeek}</label>
          {canEdit && <Button size="sm" variant="danger" disabled={action.busy} onClick={() => setRows(rows.filter(x => x.labelId !== r.labelId))}>{c.remove}</Button>}
          {(r.perWeek === '' || invalidRows.includes(r)) && <p id={`mix-rule-error-${index}`} className="ui-field-error" role="alert">{fillComposerCopy(c.wholeTarget, { max: maxPerWeek })}</p>}
        </li>)}</ul>
          : <p className={styles.empty}>{c.no_rules_here_yet}</p>}
        {canEdit ? <div className={styles.actions}>
          <label><span className="sr-only">{c.add_a_label}</span><select value="" disabled={action.busy || free.length === 0} onChange={e => e.target.value && setRows([...rows, { labelId: e.target.value, perWeek: 1 }])}><option value="">{c.add_a_label_2}</option>{free.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
          <Button variant="primary" disabled={drafts[draftKey] === undefined || action.busy || invalidRows.length > 0} onClick={() => setReview(true)}>{c.review_changes}</Button>{drafts[draftKey] !== undefined && <Button disabled={action.busy} onClick={discard}>{c.discard_changes}</Button>}
        </div> : <p className={styles.help}>{'groupId' in scope ? c.group_mixes_can_be_changed_by_owners_and_admins_with_access_to : c.only_workspace_owners_and_admins_can_change_the_content_mix}</p>}
      </> : <p className={styles.empty}>{c.choose_a_channel_or_group_from_the_sidebar_to_review_its_rules}</p>}
    </section>
    <ConfirmDialog feedback={action.feedback} open={review} confirmationMode="review" title={c.review_content_mix} description={fillComposerCopy(c.mixReview, { scope: scope && 'groupId' in scope ? c.group : c.channel_2, count: rows.length, plural: rows.length === 1 ? '' : 's' })} confirmation={confirmation} actionLabel={c.save_content_mix} busy={action.busy} onCancel={() => setReview(false)} onConfirm={() => void save()}>
      <ul>{rows.map(r => <li key={r.labelId}>{r.perWeek || c.invalid_target}{c.perWeek} · {name(r.labelId)}</li>)}</ul></ConfirmDialog>
    <ConfirmDialog feedback={action.feedback} open={autoFillReview} confirmationMode="review" title={fillComposerCopy(c.autoFillTitle, { action: autoFillDesired ? c.enable : c.disable })} description={autoFillDesired ? c.eligible_drafts_may_be_scheduled_by_the_content_mix_automation_saving_mix : c.the_content_mix_automation_will_stop_scheduling_new_posts_existing_scheduled_posts} confirmation={mixAutoFillConfirmation(autoFillDesired)} actionLabel={autoFillDesired ? c.enable_scheduling : c.disable_scheduling} busy={action.busy} onCancel={() => { setAutoFillReview(false); setAutoFillDesired(autoFillEnabled); }} onConfirm={() => void saveAutoFill()} />
  </div>;
}
