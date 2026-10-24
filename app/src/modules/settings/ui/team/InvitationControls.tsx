'use client';
import { useConfirmedAction } from '@/modules/settings/ui/use-confirmed-action';
import { useSettingsCopy } from '@/modules/settings/ui/copy-context';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/Button';
import { DataTable, Badge, Select, ConfirmDialog, useToast } from '@/components';
import { FieldError, useFormValidation } from '@/components/FormValidation';
import { fill } from '@/modules/settings/ui/shell-copy';

import styles from './invitations.module.css';

type Invitation = { id: string; email: string; role: string; expiresAt: string; acceptedAt: string | null; createdAt: string; status: 'pending' | 'expired' | 'accepted' };
type Delivery = 'sent' | 'failed' | 'uncertain' | 'unavailable';
type Feedback = { text: string; error: boolean };

const ROLES = ['owner', 'admin', 'editor', 'contributor', 'viewer', 'client'] as const;
const confirmationForInvite = (email: string) => `INVITE MEMBER ${email.trim().toLowerCase()}`;
const confirmationForRevoke = (id: string) => `REVOKE INVITATION ${id}`;
const managerRole = (role: string) => role === 'owner' || role === 'admin';

export function InvitationControls({ invitations, actorRole, available, locale = 'en' }: {
  invitations: Invitation[];
  actorRole: string;
  available: boolean;
  locale?: 'en' | 'fr';
}) {
  const toast = useToast();
  const confirmedAction = useConfirmedAction();
  const t = useSettingsCopy('invitations', locale);
  const roles = useSettingsCopy('roles', locale);
  const roleLabel = (role: string) => (roles as Record<string, string>)[role] ?? role;
  const dateFormatter = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' });
  const utcDate = (value: string) => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? t.dateUnavailable : `${dateFormatter.format(date)} UTC`;
  };
  const router = useRouter();
  const validation = useFormValidation();
  const mounted = useRef(true);
  const pendingRequest = useRef<AbortController | null>(null);
  const feedbackRef = useRef<HTMLParagraphElement>(null);
  const dialogFeedbackRef = useRef<HTMLParagraphElement>(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<(typeof ROLES)[number]>('contributor');
  const [inviteReview, setInviteReview] = useState(false);
  const [reissuing, setReissuing] = useState<Invitation | null>(null);
  const [revoking, setRevoking] = useState<Invitation | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      pendingRequest.current?.abort();
      pendingRequest.current = null;
    };
  }, []);
  useEffect(() => {
    if (!feedback) return;
    if (inviteReview || revoking) dialogFeedbackRef.current?.focus();
    else feedbackRef.current?.focus();
  }, [feedback, inviteReview, revoking]);

  const canonicalEmail = email.trim().toLowerCase();
  const inviteConfirmation = confirmationForInvite(canonicalEmail);
  const canManage = actorRole === 'owner' || actorRole === 'admin';
  const pendingForEmail = invitations.find(item => item.status === 'pending' && item.email.trim().toLowerCase() === canonicalEmail);

  function closeDialogs() {
    if (busy) return;
    setInviteReview(false);
    setReissuing(null);
    setRevoking(null);

    setFeedback(null);
  }

  function startInvite(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const errors: Record<string, string> = {};
    if (!canonicalEmail) errors.email = t.emailRequired;
    if (!validation.validate(event.currentTarget, errors)) return;
    setFeedback(null);

    setReissuing(pendingForEmail ?? null);
    setInviteReview(true);
  }

  function beginReissue(invitation: Invitation) {
    setEmail(invitation.email);
    setRole(ROLES.includes(invitation.role as (typeof ROLES)[number]) ? invitation.role as (typeof ROLES)[number] : 'contributor');
    validation.clearAll();
    setReissuing(invitation);
    setInviteReview(true);

    setFeedback(null);
  }

  async function request(method: 'POST' | 'DELETE', body: Record<string, string>, expectedId?: string): Promise<{ id: string; delivery?: Delivery; expiresAt?: string } | null> {
    if (pendingRequest.current) return null;
    const controller = new AbortController();
    pendingRequest.current = controller;
    setBusy(true);
    setFeedback(null);
    let responseReceived = false;
    try {
      const response = await fetch('/api/settings/team/invitations', {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      responseReceived = true;
      const value: unknown = await response.json().catch(() => null);
      const payload = value && typeof value === 'object' ? value as Record<string, unknown> : {};
      if (!response.ok) {
        throw new Error(typeof payload.error === 'string' && payload.error.trim() ? payload.error : t.unconfirmed);
      }
      if (payload.ok !== true || typeof payload.id !== 'string' || !payload.id || (expectedId && payload.id !== expectedId)) {
        throw new Error(t.unconfirmed);
      }
      if (method === 'POST') {
        if (!['sent', 'failed', 'uncertain', 'unavailable'].includes(String(payload.delivery)) || typeof payload.expiresAt !== 'string') {
          throw new Error(t.incomplete);
        }
        return { id: payload.id, delivery: payload.delivery as Delivery, expiresAt: payload.expiresAt };
      }
      if (payload.revoked !== true) throw new Error(t.revokeUnconfirmed);
      return { id: payload.id };
    } catch (error) {
      if (!mounted.current || (error instanceof DOMException && error.name === 'AbortError')) return null;
      const message = responseReceived
        ? error instanceof Error ? error.message : t.changeFailed
        : t.unconfirmedNetwork;
      setFeedback({ text: message, error: true }); toast.failed(message, () => router.refresh(), t.list);
      return null;
    } finally {
      if (pendingRequest.current === controller) pendingRequest.current = null;
      if (mounted.current) setBusy(false);
    }
  }

  async function createInvitation() {
    const result = await request('POST', { email: canonicalEmail, role, confirmation: inviteConfirmation });
    if (!result || !mounted.current) return t.unconfirmed;
    const expiry = utcDate(result.expiresAt ?? '');
    const values = { email: canonicalEmail, expiry, extra: reissuing ? t.reissued : '' };
    const text = result.delivery === 'sent'
      ? fill(t.sent, values)
      : result.delivery === 'uncertain'
        ? fill(t.uncertain, values)
        : result.delivery === 'failed'
          ? fill(t.failed, values)
          : fill(t.unavailableDelivery, values);
    toast.notify({ title: text, tone: result.delivery === 'sent' ? 'success' : 'error' });
    setFeedback({ text, error: result.delivery === 'failed' || result.delivery === 'uncertain' || result.delivery === 'unavailable' });
    setInviteReview(false);
    setReissuing(null);

    validation.clearAll();
    router.refresh();
  }

  async function revokeInvitation() {
    if (!revoking) return;
    const invitation = revoking;
    const result = await request('DELETE', { id: invitation.id, confirmation: confirmationForRevoke(invitation.id) }, invitation.id);
    if (!result || !mounted.current) return t.revokeUnconfirmed;
    const text = fill(t.revokedDone, { email: invitation.email });
    setFeedback({ text, error: false }); toast.notify({ title: text });
    setRevoking(null);

    router.refresh();
  }

  return <section className={styles.invitations} aria-labelledby="team-invitations-heading">
    <div className={styles.heading}><div><h2 id="team-invitations-heading">{t.heading}</h2><p>{t.intro}</p></div></div>

    {canManage && !available && <p className={styles.unavailable} role="status">{t.unavailable}</p>}
    {canManage && available && <form method="post" noValidate className={styles.form} onSubmit={startInvite}>
      <div className={styles.fields}>
        <label className={styles.field} htmlFor="team-invitation-email">{t.emailAddress}
          <input id="team-invitation-email" name="email" type="email" autoComplete="email" required maxLength={320} value={email} disabled={busy} aria-invalid={validation.errors.email ? true : undefined} aria-describedby={validation.errors.email ? 'team-invitation-email-error' : 'team-invitation-email-help'} onChange={event => {
            const next = event.currentTarget.value;
            setEmail(next);
            validation.clear('email');
            if (reissuing && next.trim().toLowerCase() !== reissuing.email.trim().toLowerCase()) setReissuing(null);

          }} />
          {validation.errors.email ? <FieldError id="team-invitation-email-error">{validation.errors.email}</FieldError> : <span id="team-invitation-email-help" className={styles.hint}>{t.emailHint}</span>}
        </label>
        <label className={styles.field}>{t.workspaceRole}
          <Select aria-label={t.workspaceRole} value={role} disabled={busy} onChange={value => { setRole(value as (typeof ROLES)[number]); }} options={ROLES.filter(option => !(actorRole === 'admin' && option === 'owner')).map(option => ({ value: option, label: roleLabel(option) }))} />
        </label>
      </div>
      <p className={styles.scopeNote}>{t.scopeNote}</p>
      {pendingForEmail && !reissuing && <p className={styles.warning} role="note">{t.pendingWarning}</p>}
      <div className={styles.actions}><Button variant="primary" type="submit" disabled={busy}>{pendingForEmail && !reissuing ? t.reviewReissue : t.reviewInvitation}</Button></div>
    </form>}

    {feedback && !inviteReview && !revoking && <p ref={feedbackRef} tabIndex={-1} role={feedback.error ? 'alert' : 'status'} className={feedback.error ? styles.error : styles.success}>{feedback.text}</p>}

    <DataTable caption={t.caption} rows={invitations} rowKey={invitation => invitation.id} emptyMessage={t.none} columns={[
      { key: 'email', label: t.email, render: invitation => invitation.email },
      { key: 'role', label: t.role, render: invitation => roleLabel(invitation.role) },
      { key: 'status', label: t.status, render: invitation => <><Badge tone={invitation.status === 'expired' ? 'warning' : invitation.status === 'accepted' ? 'success' : 'module'}>{t.statuses[invitation.status]}</Badge>{invitation.acceptedAt && <span className={styles.acceptedAt}>{fill(t.accepted, { date: utcDate(invitation.acceptedAt) })}</span>}</> },
      { key: 'expires', label: t.expires, render: invitation => utcDate(invitation.expiresAt) },
      { key: 'actions', label: t.actions, render: invitation => <div className={styles.rowActions}>
        {canManage && invitation.status !== 'accepted' && (actorRole === 'owner' || invitation.role !== 'owner') && <Button size="sm" disabled={busy || !available} onClick={() => beginReissue(invitation)}>{t.reissue}</Button>}
        {canManage && invitation.status === 'pending' && <Button size="sm" variant="quiet" disabled={busy} onClick={() => { setRevoking(invitation); setFeedback(null); }}>{t.revoke}</Button>}
        {!canManage && <span className={styles.hint}>{t.viewOnly}</span>}
      </div> },
    ]} />

    {inviteReview && <ConfirmDialog open title={reissuing ? t.reviewReissueTitle : t.reviewTitle} objectName={canonicalEmail} consequence={`${fill(t.reviewDetail, { email: canonicalEmail, role: roleLabel(role) })} ${managerRole(role) ? t.allIncluded : t.noChannels}. ${reissuing ? t.reissueWarning : ''}`} confirmLabel={reissuing ? t.reissueInvitation : t.createInvitation} cancelLabel={t.back} pendingLabel={t.creating} failureLabel={t.unconfirmed} danger={false} onClose={() => { setInviteReview(false); setReissuing(null); }} onConfirm={() => confirmedAction(async () => (await createInvitation()) ?? null)} />}

    {revoking && <ConfirmDialog open title={t.revokeTitle} objectName={revoking.email} consequence={t.revokeCopy} confirmLabel={t.revokeInvitation} cancelLabel={t.keepInvitation} pendingLabel={t.revoking} failureLabel={t.revokeUnconfirmed} onClose={() => { if (!busy) { setRevoking(null); } }} onConfirm={() => confirmedAction(async () => (await revokeInvitation()) ?? null)} />}

  </section>;
}
