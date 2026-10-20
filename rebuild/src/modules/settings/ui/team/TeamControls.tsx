'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/Button';
import { Dialog } from '@/components/Dialog';
import { FieldError, useFormValidation } from '@/components/FormValidation';
import { addTeamConfirmation, removeTeamConfirmation, TEAM_ROLES, updateTeamConfirmation } from '@/modules/settings/team';
import { fill } from '@/modules/settings/ui/shell-copy';
import { teamCopy, teamRoleLabel } from './copy';
import styles from './team.module.css';

type Member = { id: string; userId: string; role: string; name: string; email: string; allPages: boolean; targetIds: string[] };
type Target = { id: string; name: string; type: string };
type Scope = { allPages: boolean; targetIds: string[] };
type ReceiptAction = 'added' | 'updated' | 'removed';

const managerRole = (role: string) => role === 'owner' || role === 'admin';

export function TeamControls({ members, targets, actorId, actorRole, total = members.length, hasMore = false, defaultRole = 'contributor', defaultAllPages = false, locale = 'en' }: {
  locale?: 'en' | 'fr';
  members: Member[];
  targets: Target[];
  actorId: string;
  actorRole: string;
  total?: number;
  hasMore?: boolean;
  defaultRole?: string;
  defaultAllPages?: boolean;
}) {
  const t = teamCopy[locale];
  const roleLabel = (role: string) => teamRoleLabel(locale, role);
  const router = useRouter();
  const validation = useFormValidation();
  const mounted = useRef(true);
  const pendingRequest = useRef<{ controller: AbortController } | null>(null);
  const feedbackRef = useRef<HTMLParagraphElement>(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState(defaultRole);
  const [scope, setScope] = useState<Scope>({ allPages: defaultAllPages, targetIds: [] });
  const [editing, setEditing] = useState<Member | null>(null);
  const [editRole, setEditRole] = useState(defaultRole);
  const [editScope, setEditScope] = useState<Scope>({ allPages: defaultAllPages, targetIds: [] });
  const [removing, setRemoving] = useState<Member | null>(null);
  const [confirmation, setConfirmation] = useState('');
  const [addReview, setAddReview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ text: string; error: boolean } | null>(null);

  // A ref blocks duplicate submits before React commits the pending state.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      pendingRequest.current?.controller.abort();
      pendingRequest.current = null;
    };
  }, []);
  useEffect(() => { if (feedback) feedbackRef.current?.focus(); }, [feedback]);

  const canonicalEmail = email.trim().toLowerCase();
  const addConfirmation = addTeamConfirmation(canonicalEmail);
  const editConfirmation = editing ? updateTeamConfirmation(editing.id) : '';
  const removeConfirmation = removing ? removeTeamConfirmation(removing.id) : '';
  const effectiveScope = (selectedRole: string, selectedScope: Scope) => managerRole(selectedRole) || selectedScope.allPages ? { allPages: true, targetIds: [] } : selectedScope;
  const scopeForRole = (selectedRole: string, selectedScope: Scope) => managerRole(selectedRole) ? { allPages: true, targetIds: selectedScope.targetIds } : selectedScope;

  function resetConfirmation() { setConfirmation(''); }
  function beginEdit(member: Member) {
    setEditing(member);
    setEditRole(member.role);
    setEditScope({ allPages: managerRole(member.role) || member.allPages, targetIds: member.targetIds });
    resetConfirmation();
    setFeedback(null);
  }
  function closeDialogs() {
    if (busy) return;
    setAddReview(false); setEditing(null); setRemoving(null); resetConfirmation(); setFeedback(null);
  }

  async function submit(method: 'POST' | 'PATCH' | 'DELETE', body: Record<string, unknown>, expected: ReceiptAction) {
    if (pendingRequest.current) return;
    const controller = new AbortController();
    pendingRequest.current = { controller };
    setBusy(true);
    setFeedback(null);
    let responseReceived = false;
    try {
      const response = await fetch('/api/settings/team', { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal });
      responseReceived = true;
      const result: unknown = await response.json().catch(() => null);
      const payload = result && typeof result === 'object' ? result as Record<string, unknown> : {};
      if (!response.ok) {
        const message = typeof payload.error === 'string' && payload.error.trim() ? payload.error : t.unconfirmed;
        throw new Error(message);
      }
      const expectedId = typeof body.membershipId === 'string' ? body.membershipId : null;
      if (payload.ok !== true || typeof payload.id !== 'string' || payload.id.length === 0 || (expectedId !== null && payload.id !== expectedId) || payload[expected] !== true) {
        throw new Error(t.unconfirmed);
      }
      if (!mounted.current) return;
      setFeedback({ text: expected === 'added' ? t.added : expected === 'updated' ? t.updated : t.removed, error: false });
      setAddReview(false); setEditing(null); setRemoving(null); setConfirmation('');
      router.refresh();
    } catch (error) {
      if (!mounted.current || (error instanceof DOMException && error.name === 'AbortError')) return;
      const message = responseReceived
        ? error instanceof Error ? error.message : t.teamFailed
        : t.unconfirmed;
      setFeedback({ text: message, error: true });
    } finally {
      if (pendingRequest.current?.controller === controller) pendingRequest.current = null;
      if (mounted.current) setBusy(false);
    }
  }

  function startAdd(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const errors: Record<string, string> = {};
    if (!canonicalEmail) errors.email = t.emailRequired;
    else if (members.some(member => member.email.trim().toLowerCase() === canonicalEmail)) errors.email = t.alreadyMember;
    if (!validation.validate(event.currentTarget, errors)) return;
    setFeedback(null); resetConfirmation(); setAddReview(true);
  }

  function targetChoices(current: Scope, update: (next: Scope) => void, disabled: boolean) {
    return <fieldset className={styles.scope}>
      <legend>{t.channelAccess}</legend>
      <label className={styles.scopeAll}><input type="checkbox" checked={current.allPages} disabled={disabled} onChange={event => update({ allPages: event.currentTarget.checked, targetIds: current.targetIds })} />{t.allChannels}</label>
      {targets.length ? <div className={styles.scopeList}>{targets.map(target => <label key={target.id}>
        <input type="checkbox" checked={!current.allPages && current.targetIds.includes(target.id)} disabled={disabled || current.allPages} onChange={event => update({ allPages: false, targetIds: event.currentTarget.checked ? [...current.targetIds, target.id] : current.targetIds.filter(id => id !== target.id) })} />
        <span>{target.name}<small>{target.type}</small></span>
      </label>)}</div> : <p className={styles.scopeEmpty}>{t.noChannelsToAssign}</p>}
    </fieldset>;
  }

  function roleSelect(value: string, onChange: (value: string) => void, disabled: boolean, name: string) {
    const choices = TEAM_ROLES.filter(item => item !== 'owner' || actorRole === 'owner' || value === 'owner');
    return <label className={styles.field}>{name}
      <select value={value} disabled={disabled} onChange={event => onChange(event.currentTarget.value)}>
        {choices.map(item => <option key={item} value={item}>{roleLabel(item)}</option>)}
      </select>
    </label>;
  }

  const canManage = actorRole === 'owner' || actorRole === 'admin';
  const availableTargetIds = new Set(targets.map(target => target.id));
  const originalUnavailableIds = editing?.targetIds.filter(id => !availableTargetIds.has(id)) ?? [];
  const retainedUnavailableCount = editScope.targetIds.filter(id => !availableTargetIds.has(id)).length;
  const showUnavailableGrantControls = Boolean(editing && !managerRole(editRole) && !editScope.allPages);
  const removedUnavailableCount = showUnavailableGrantControls ? Math.max(0, originalUnavailableIds.length - retainedUnavailableCount) : 0;

  return <div className={styles.team}>
    {canManage && <form method="post" className={styles.addForm} noValidate onSubmit={startAdd}>
      <div className={styles.addIntro}><div><h3>{t.addTitle}</h3><p>{t.addHint}</p></div><span className={styles.count}>{fill(t.totalCount, { count: total })}</span></div>
      <div className={styles.addFields}>
        <label className={styles.field} htmlFor="team-member-email">{t.emailAddress}
          <input id="team-member-email" name="email" type="email" autoComplete="email" value={email} maxLength={320} disabled={busy} aria-invalid={validation.errors.email ? true : undefined} aria-describedby={validation.errors.email ? 'team-member-email-error' : 'team-member-email-help'} onChange={event => { setEmail(event.currentTarget.value); validation.clear('email'); }} />
          {validation.errors.email ? <FieldError id="team-member-email-error">{validation.errors.email}</FieldError> : <span id="team-member-email-help" className={styles.hint}>{t.accountExists}</span>}
        </label>
        {roleSelect(role, value => { setRole(value); setScope(prev => scopeForRole(value, prev)); setConfirmation(''); }, busy, t.workspaceRole)}
      </div>
      {managerRole(role) ? <p className={styles.scopeNote}>{t.managersAll}</p> : targetChoices(scope, next => { setScope(next); setConfirmation(''); }, busy)}
      <div className={styles.addActions}><Button variant="primary" type="submit" disabled={busy}>{t.reviewAccess}</Button></div>
    </form>}

    {feedback && !feedback.error && <p ref={feedbackRef} tabIndex={-1} className={styles.success} role="status">{feedback.text}</p>}

    {hasMore && <p className={styles.directoryLimit}>{fill(t.showing, { shown: members.length, total })}</p>}
    <div className={styles.tableWrap} role="region" aria-label={t.directory} tabIndex={0}>
      <table className={styles.table}>
        <caption className={styles.visuallyHidden}>{t.caption}</caption>
        <thead><tr><th scope="col">{t.person}</th><th scope="col">{t.workspaceRole}</th><th scope="col">{t.channelAccess}</th><th scope="col"><span className={styles.visuallyHidden}>{t.memberActions}</span></th></tr></thead>
        <tbody>{members.map(member => {
          const blockedOwner = member.role === 'owner' && actorRole !== 'owner';
          const canEditMember = member.userId !== actorId && !blockedOwner;
          const memberTargets = targets.filter(target => member.targetIds.includes(target.id));
          const missingTargetCount = member.targetIds.filter(id => !targets.some(target => target.id === id)).length;
          const fullChannelAccess = managerRole(member.role) || member.allPages;
          return <tr key={member.id}>
            <th scope="row"><span className={styles.person}>{member.name || member.email}{member.userId === actorId && <span className={styles.you}>{t.you}</span>}</span><span className={styles.email}>{member.email}</span></th>
            <td><span className={styles.role}>{roleLabel(member.role)}</span></td>
            <td>{fullChannelAccess ? <span className={styles.channelSummary}><span>{t.allChannels}</span></span> : memberTargets.length || missingTargetCount ? <span className={styles.channelSummary}>{memberTargets.map(target => <span key={target.id}>{target.name}</span>)}{Boolean(missingTargetCount) && <span>{missingTargetCount === 1 ? t.unavailableOne : fill(t.unavailableMany, { count: missingTargetCount })}</span>}</span> : <span className={styles.none}>{t.noneSelected}</span>}</td>
            <td><div className={styles.rowActions}>{!canManage ? <span className={styles.hint}>{t.viewOnly}</span> : member.userId === actorId ? <span className={styles.hint}>{t.yourAccount}</span> : blockedOwner ? <span className={styles.hint}>{t.ownerOnly}</span> : canEditMember && <><Button size="sm" disabled={busy} onClick={() => beginEdit(member)}>{t.editAccess}</Button><Button size="sm" variant="quiet" disabled={busy} onClick={() => { setRemoving(member); setConfirmation(''); setFeedback(null); }}>{t.remove}</Button></>}</div></td>
          </tr>;
        })}</tbody>
      </table>
    </div>

    <Dialog open={addReview} title={t.reviewNew} description={t.reviewNewDetail} onClose={closeDialogs} busy={busy} actions={<><Button data-dialog-cancel disabled={busy} onClick={closeDialogs}>{t.back}</Button><Button variant="primary" disabled={busy || confirmation !== addConfirmation} onClick={() => void submit('POST', { email: canonicalEmail, role, targetIds: effectiveScope(role, scope).targetIds, allPages: effectiveScope(role, scope).allPages, confirmation: addConfirmation }, 'added')}>{busy ? t.adding : t.addMember}</Button></>}>
      <div className={styles.review}><p><span>{t.account}</span><strong>{canonicalEmail}</strong></p><p><span>{t.role}</span><strong>{roleLabel(role)}</strong></p><p><span>{t.channels}</span><strong>{managerRole(role) ? t.allIncluded : scope.allPages ? t.allChannels : targets.filter(target => scope.targetIds.includes(target.id)).map(target => target.name).join(', ') || t.noneSelected}</strong></p></div>
      <ConfirmationField locale={locale} expected={addConfirmation} value={confirmation} onChange={setConfirmation} busy={busy} />
      {feedback?.error && <p ref={feedbackRef} tabIndex={-1} className={styles.error} role="alert">{feedback.text}</p>}
    </Dialog>

    <Dialog open={Boolean(editing)} title={t.editTitle} description={editing ? fill(t.editDetail, { name: editing.name || editing.email }) : undefined} onClose={closeDialogs} busy={busy} actions={<><Button data-dialog-cancel disabled={busy} onClick={closeDialogs}>{t.cancel}</Button><Button variant="primary" disabled={busy || !editing || confirmation !== editConfirmation} onClick={() => editing && void submit('PATCH', { membershipId: editing.id, role: editRole, targetIds: effectiveScope(editRole, editScope).targetIds, allPages: effectiveScope(editRole, editScope).allPages, confirmation: editConfirmation }, 'updated')}>{busy ? t.saving : t.saveAccess}</Button></>}>
      {editing && <>
        {roleSelect(editRole, value => { setEditRole(value); setEditScope(prev => scopeForRole(value, prev)); setConfirmation(''); }, busy || (editing.userId === actorId) || (editing.role === 'owner' && actorRole !== 'owner'), t.workspaceRole)}
        {managerRole(editRole) ? <p className={styles.scopeNote}>{t.managersAll}</p> : <>
          {targetChoices(editScope, next => { setEditScope(next); setConfirmation(''); }, busy)}
          {showUnavailableGrantControls && retainedUnavailableCount > 0 && <div className={styles.unavailableGrant}><p>{retainedUnavailableCount === 1 ? t.grantOne : fill(t.grantMany, { count: retainedUnavailableCount })}</p><Button size="sm" disabled={busy} onClick={() => { setEditScope(current => ({ ...current, targetIds: current.targetIds.filter(id => availableTargetIds.has(id)) })); setConfirmation(''); }}>{retainedUnavailableCount === 1 ? t.removeGrantOne : fill(t.removeGrantMany, { count: retainedUnavailableCount })}</Button></div>}
          {removedUnavailableCount > 0 && <p className={styles.removalWarning} role="note">{removedUnavailableCount === 1 ? t.savingRemovesOne : fill(t.savingRemovesMany, { count: removedUnavailableCount })}</p>}
        </>}
        <ConfirmationField locale={locale} expected={editConfirmation} value={confirmation} onChange={setConfirmation} busy={busy} action="UPDATE" />
        {feedback?.error && <p ref={feedbackRef} tabIndex={-1} className={styles.error} role="alert">{feedback.text}</p>}
      </>}
    </Dialog>

    <Dialog open={Boolean(removing)} title={t.removeTitle} description={removing ? fill(t.removeDetail, { name: removing.name || removing.email }) : undefined} onClose={closeDialogs} busy={busy} actions={<><Button data-dialog-cancel disabled={busy} onClick={closeDialogs}>{t.keepMember}</Button><Button variant="danger" disabled={busy || !removing || confirmation !== removeConfirmation} onClick={() => removing && void submit('DELETE', { membershipId: removing.id, confirmation: removeConfirmation }, 'removed')}>{busy ? t.removing : t.removeFromWorkspace}</Button></>}>
      {removing && <><p className={styles.removeCopy}>{t.removeCopy}</p><ConfirmationField locale={locale} expected={removeConfirmation} value={confirmation} onChange={setConfirmation} busy={busy} action="REMOVE" /><p className={styles.hint}>{t.immediate}</p>{feedback?.error && <p ref={feedbackRef} tabIndex={-1} className={styles.error} role="alert">{feedback.text}</p>}</>}
    </Dialog>
  </div>;
}

function ConfirmationField({ expected, value, onChange, busy, action = 'ADD', locale = 'en' }: { expected: string; value: string; onChange: (value: string) => void; busy: boolean; action?: 'ADD' | 'UPDATE' | 'REMOVE'; locale?: 'en' | 'fr' }) {
  const t = teamCopy[locale];
  const [before, after] = t.confirmType.split('{code}');
  return <label className={styles.confirmField}>
    <span>{before}<code>{expected}</code>{after}</span>
    <input value={value} autoComplete="off" disabled={busy} aria-label={fill(t.confirmAria, { action })} onChange={event => onChange(event.currentTarget.value)} />
  </label>;
}
