'use client';
import { useSettingsCopy } from '@/modules/settings/ui/copy-context';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { DataTable, Badge, Select, ConfirmDialog, useToast } from '@/components';
import { Button } from '@/components/Button';
import { Dialog } from '@/components/Dialog';
import { FieldError, useFormValidation } from '@/components/FormValidation';
import { addTeamConfirmation, removeTeamConfirmation, TEAM_ROLES, updateTeamConfirmation } from '@/modules/settings/team';
import { fill } from '@/modules/settings/ui/shell-copy';

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
  const toast = useToast();
  const t = useSettingsCopy('team', locale);
  const roles = useSettingsCopy('roles', locale);
  const roleLabel = (role: string) => (roles as Record<string, string>)[role] ?? role;
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
  const [editReview, setEditReview] = useState(false);
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
  const effectiveScope = (selectedRole: string, selectedScope: Scope) => managerRole(selectedRole) || selectedScope.allPages ? { allPages: true, targetIds: [] } : selectedScope;
  const scopeForRole = (selectedRole: string, selectedScope: Scope) => managerRole(selectedRole) ? { allPages: true, targetIds: selectedScope.targetIds } : selectedScope;

  function beginEdit(member: Member) {
    setEditing(member);
    setEditRole(member.role);
    setEditScope({ allPages: managerRole(member.role) || member.allPages, targetIds: member.targetIds });
    setFeedback(null);
  }
  function closeDialogs() {
    if (busy) return;
    setEditReview(false); setAddReview(false); setEditing(null); setRemoving(null); setFeedback(null);
  }

  const confirmedRequest = useRef<Promise<string | null | undefined> | null>(null);
  function confirmedSubmit(method: 'POST' | 'PATCH' | 'DELETE', body: Record<string, unknown>, expected: ReceiptAction) {
    if (confirmedRequest.current) return confirmedRequest.current;
    confirmedRequest.current = submit(method, body, expected).finally(() => { confirmedRequest.current = null; });
    return confirmedRequest.current;
  }
  async function submit(method: 'POST' | 'PATCH' | 'DELETE', body: Record<string, unknown>, expected: ReceiptAction) {
    if (pendingRequest.current) return t.unconfirmed;
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
      const text = expected === 'added' ? t.added : expected === 'updated' ? t.updated : t.removed;
      setFeedback({ text, error: false }); toast.notify({ title: text });
      setEditReview(false); setAddReview(false); setEditing(null); setRemoving(null);
      router.refresh(); return null;
    } catch (error) {
      if (!mounted.current || (error instanceof DOMException && error.name === 'AbortError')) return;
      const message = responseReceived
        ? error instanceof Error ? error.message : t.teamFailed
        : t.unconfirmed;
      setFeedback({ text: message, error: true }); toast.failed(message, () => router.refresh(), t.directory); return message;
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
    setFeedback(null); setAddReview(true);
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
<Select aria-label={name} name="role" value={value} disabled={disabled} onChange={onChange} options={choices.map(item => ({ value: item, label: roleLabel(item) }))} />
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
        {roleSelect(role, value => { setRole(value); setScope(prev => scopeForRole(value, prev)); }, busy, t.workspaceRole)}
      </div>
      {managerRole(role) ? <p className={styles.scopeNote}>{t.managersAll}</p> : targetChoices(scope, next => { setScope(next); }, busy)}
      <div className={styles.addActions}><Button variant="primary" type="submit" disabled={busy}>{t.reviewAccess}</Button></div>
    </form>}

    {feedback && !feedback.error && <p ref={feedbackRef} tabIndex={-1} className={styles.success} role="status">{feedback.text}</p>}

    {hasMore && <p className={styles.directoryLimit}>{fill(t.showing, { shown: members.length, total })}</p>}
    <DataTable caption={t.caption} rows={members} rowKey={member => member.id} emptyMessage={t.noneSelected} columns={[
      { key: 'person', label: t.person, render: member => <><span className={styles.person}>{member.name || member.email}{member.userId === actorId && <span className={styles.you}>{t.you}</span>}</span><span className={styles.email}>{member.email}</span></> },
      { key: 'role', label: t.workspaceRole, render: member => <Badge tone={managerRole(member.role) ? 'module' : 'neutral'}>{roleLabel(member.role)}</Badge> },
      { key: 'scope', label: t.channelAccess, render: member => {
        const memberTargets = targets.filter(target => member.targetIds.includes(target.id));
        const missingTargetCount = member.targetIds.filter(id => !targets.some(target => target.id === id)).length;
        return managerRole(member.role) || member.allPages ? <span>{t.allChannels}</span> : memberTargets.length || missingTargetCount ? <span className={styles.channelSummary}>{memberTargets.map(target => <span key={target.id}>{target.name}</span>)}{Boolean(missingTargetCount) && <span>{missingTargetCount === 1 ? t.unavailableOne : fill(t.unavailableMany, { count: missingTargetCount })}</span>}</span> : <span className={styles.none}>{t.noneSelected}</span>;
      } },
      { key: 'actions', label: t.memberActions, render: member => <div className={styles.rowActions}>{!canManage ? <span className={styles.hint}>{t.viewOnly}</span> : member.userId === actorId ? <span className={styles.hint}>{t.yourAccount}</span> : member.role === 'owner' && actorRole !== 'owner' ? <span className={styles.hint}>{t.ownerOnly}</span> : <><Button size="sm" disabled={busy} onClick={() => beginEdit(member)}>{t.editAccess}</Button><Button size="sm" variant="quiet" disabled={busy} onClick={() => { setRemoving(member); setFeedback(null); }}>{t.remove}</Button></>}</div> },
    ]} />

    {addReview && <ConfirmDialog open title={t.reviewNew} objectName={canonicalEmail} consequence={`${t.role}: ${roleLabel(role)}. ${t.channels}: ${managerRole(role) || scope.allPages ? t.allChannels : targets.filter(target => scope.targetIds.includes(target.id)).map(target => target.name).join(', ') || t.noneSelected}. ${t.immediate}`} confirmLabel={t.addMember} cancelLabel={t.back} failureLabel={t.unconfirmed} danger={false} onClose={() => setAddReview(false)} onConfirm={async () => (await confirmedSubmit('POST', { email: canonicalEmail, role, targetIds: effectiveScope(role, scope).targetIds, allPages: effectiveScope(role, scope).allPages, confirmation: addConfirmation }, 'added')) ?? null} />}

    <Dialog closeLabel={t.cancel} open={Boolean(editing) && !editReview} title={t.editTitle} description={editing ? fill(t.editDetail, { name: editing.name || editing.email }) : undefined} onClose={closeDialogs} busy={busy} actions={<><Button data-dialog-cancel disabled={busy} onClick={closeDialogs}>{t.cancel}</Button><Button variant="primary" disabled={busy || !editing} onClick={() => setEditReview(true)}>{busy ? t.saving : t.saveAccess}</Button></>}>
      {editing && <>
        {roleSelect(editRole, value => { setEditRole(value); setEditScope(prev => scopeForRole(value, prev)); }, busy || (editing.userId === actorId) || (editing.role === 'owner' && actorRole !== 'owner'), t.workspaceRole)}
        {managerRole(editRole) ? <p className={styles.scopeNote}>{t.managersAll}</p> : <>
          {targetChoices(editScope, next => { setEditScope(next); }, busy)}
          {showUnavailableGrantControls && retainedUnavailableCount > 0 && <div className={styles.unavailableGrant}><p>{retainedUnavailableCount === 1 ? t.grantOne : fill(t.grantMany, { count: retainedUnavailableCount })}</p><Button size="sm" disabled={busy} onClick={() => { setEditScope(current => ({ ...current, targetIds: current.targetIds.filter(id => availableTargetIds.has(id)) })); }}>{retainedUnavailableCount === 1 ? t.removeGrantOne : fill(t.removeGrantMany, { count: retainedUnavailableCount })}</Button></div>}
          {removedUnavailableCount > 0 && <p className={styles.removalWarning} role="note">{removedUnavailableCount === 1 ? t.savingRemovesOne : fill(t.savingRemovesMany, { count: removedUnavailableCount })}</p>}
        </>}
        {feedback?.error && <p ref={feedbackRef} tabIndex={-1} className={styles.error} role="alert">{feedback.text}</p>}
      </>}
    </Dialog>

    {editing && editReview && <ConfirmDialog open title={t.saveAccess} objectName={editing.name || editing.email} consequence={`${t.role}: ${roleLabel(editRole)}. ${t.channels}: ${managerRole(editRole) || editScope.allPages ? t.allChannels : targets.filter(target => editScope.targetIds.includes(target.id)).map(target => target.name).join(', ') || t.noneSelected}. ${removedUnavailableCount ? fill(t.savingRemovesMany, { count: removedUnavailableCount }) : t.immediate}`} confirmLabel={t.saveAccess} cancelLabel={t.back} failureLabel={t.unconfirmed} danger={false} onClose={() => setEditReview(false)} onConfirm={async () => (await confirmedSubmit('PATCH', { membershipId: editing.id, role: editRole, targetIds: effectiveScope(editRole, editScope).targetIds, allPages: effectiveScope(editRole, editScope).allPages, confirmation: editConfirmation }, 'updated')) ?? null} />}
    {removing && <ConfirmDialog open title={t.removeTitle} objectName={removing.name || removing.email} consequence={t.removeCopy} confirmLabel={t.removeFromWorkspace} cancelLabel={t.keepMember} pendingLabel={t.removing} failureLabel={t.teamFailed} onClose={() => { if (!busy) { setRemoving(null); } }} onConfirm={async () => { const result = await confirmedSubmit('DELETE', { membershipId: removing.id, confirmation: removeTeamConfirmation(removing.id) }, 'removed'); return result === undefined ? t.unconfirmed : result; }} />}

  </div>;
}
