'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/Button';
import { Dialog } from '@/components/Dialog';
import { FieldError, useFormValidation } from '@/components/FormValidation';
import { fill } from '@/modules/settings/ui/shell-copy';
import { invitationCopy, teamRoleLabel } from './copy';
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
  const t = invitationCopy[locale];
  const roleLabel = (role: string) => teamRoleLabel(locale, role);
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
  const [confirmation, setConfirmation] = useState('');
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
  const revokeConfirmation = revoking ? confirmationForRevoke(revoking.id) : '';
  const canManage = actorRole === 'owner' || actorRole === 'admin';
  const pendingForEmail = invitations.find(item => item.status === 'pending' && item.email.trim().toLowerCase() === canonicalEmail);

  function closeDialogs() {
    if (busy) return;
    setInviteReview(false);
    setReissuing(null);
    setRevoking(null);
    setConfirmation('');
    setFeedback(null);
  }

  function startInvite(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const errors: Record<string, string> = {};
    if (!canonicalEmail) errors.email = t.emailRequired;
    if (!validation.validate(event.currentTarget, errors)) return;
    setFeedback(null);
    setConfirmation('');
    setReissuing(pendingForEmail ?? null);
    setInviteReview(true);
  }

  function beginReissue(invitation: Invitation) {
    setEmail(invitation.email);
    setRole(ROLES.includes(invitation.role as (typeof ROLES)[number]) ? invitation.role as (typeof ROLES)[number] : 'contributor');
    validation.clearAll();
    setReissuing(invitation);
    setInviteReview(true);
    setConfirmation('');
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
      setFeedback({ text: message, error: true });
      return null;
    } finally {
      if (pendingRequest.current === controller) pendingRequest.current = null;
      if (mounted.current) setBusy(false);
    }
  }

  async function createInvitation() {
    const result = await request('POST', { email: canonicalEmail, role, confirmation: inviteConfirmation });
    if (!result || !mounted.current) return;
    const expiry = utcDate(result.expiresAt ?? '');
    const values = { email: canonicalEmail, expiry, extra: reissuing ? t.reissued : '' };
    const text = result.delivery === 'sent'
      ? fill(t.sent, values)
      : result.delivery === 'uncertain'
        ? fill(t.uncertain, values)
        : result.delivery === 'failed'
          ? fill(t.failed, values)
          : fill(t.unavailableDelivery, values);
    setFeedback({ text, error: result.delivery === 'failed' || result.delivery === 'uncertain' || result.delivery === 'unavailable' });
    setInviteReview(false);
    setReissuing(null);
    setConfirmation('');
    validation.clearAll();
    router.refresh();
  }

  async function revokeInvitation() {
    if (!revoking) return;
    const invitation = revoking;
    const result = await request('DELETE', { id: invitation.id, confirmation: revokeConfirmation }, invitation.id);
    if (!result || !mounted.current) return;
    setFeedback({ text: fill(t.revokedDone, { email: invitation.email }), error: false });
    setRevoking(null);
    setConfirmation('');
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
            setConfirmation('');
          }} />
          {validation.errors.email ? <FieldError id="team-invitation-email-error">{validation.errors.email}</FieldError> : <span id="team-invitation-email-help" className={styles.hint}>{t.emailHint}</span>}
        </label>
        <label className={styles.field}>{t.workspaceRole}
          <select value={role} disabled={busy} onChange={event => { setRole(event.currentTarget.value as (typeof ROLES)[number]); setConfirmation(''); }}>
            {ROLES.filter(option => !(actorRole === 'admin' && option === 'owner')).map(option => <option key={option} value={option}>{roleLabel(option)}</option>)}
          </select>
        </label>
      </div>
      <p className={styles.scopeNote}>{t.scopeNote}</p>
      {pendingForEmail && !reissuing && <p className={styles.warning} role="note">{t.pendingWarning}</p>}
      <div className={styles.actions}><Button variant="primary" type="submit" disabled={busy}>{pendingForEmail && !reissuing ? t.reviewReissue : t.reviewInvitation}</Button></div>
    </form>}

    {feedback && !inviteReview && !revoking && <p ref={feedbackRef} tabIndex={-1} role={feedback.error ? 'alert' : 'status'} className={feedback.error ? styles.error : styles.success}>{feedback.text}</p>}

    {invitations.length === 0 ? <p className={styles.empty}>{t.none}</p> : <div className={styles.tableWrap} role="region" aria-label={t.list} tabIndex={0}>
      <table className={styles.table}>
        <caption className={styles.visuallyHidden}>{t.caption}</caption>
        <thead><tr><th scope="col">{t.email}</th><th scope="col">{t.role}</th><th scope="col">{t.status}</th><th scope="col">{t.expires}</th><th scope="col"><span className={styles.visuallyHidden}>{t.actions}</span></th></tr></thead>
        <tbody>{invitations.map(invitation => <tr key={invitation.id}>
          <th scope="row">{invitation.email}</th>
          <td>{roleLabel(invitation.role)}</td>
          <td><span className={`${styles.status} ${styles[`status_${invitation.status}`]}`}>{t.statuses[invitation.status]}</span>{invitation.acceptedAt && <span className={styles.acceptedAt}>{fill(t.accepted, { date: utcDate(invitation.acceptedAt) })}</span>}</td>
          <td>{utcDate(invitation.expiresAt)}</td>
          <td><div className={styles.rowActions}>
            {canManage && invitation.status !== 'accepted' && (actorRole === 'owner' || invitation.role !== 'owner') && <Button size="sm" disabled={busy || !available} onClick={() => beginReissue(invitation)}>{t.reissue}</Button>}
            {canManage && invitation.status === 'pending' && <Button size="sm" variant="quiet" disabled={busy} onClick={() => { setRevoking(invitation); setConfirmation(''); setFeedback(null); }}>{t.revoke}</Button>}
            {!canManage && <span className={styles.hint}>{t.viewOnly}</span>}
          </div></td>
        </tr>)}</tbody>
      </table>
    </div>}

    <Dialog open={inviteReview} title={reissuing ? t.reviewReissueTitle : t.reviewTitle} description={fill(t.reviewDetail, { email: canonicalEmail, role: roleLabel(role) })} onClose={closeDialogs} busy={busy} actions={<><Button data-dialog-cancel disabled={busy} onClick={closeDialogs}>{t.back}</Button><Button variant="primary" disabled={busy || confirmation !== inviteConfirmation} onClick={() => void createInvitation()}>{busy ? t.creating : reissuing ? t.reissueInvitation : t.createInvitation}</Button></>}>
      <div className={styles.review}><p><span>{t.email}</span><strong>{canonicalEmail}</strong></p><p><span>{t.workspaceRole}</span><strong>{roleLabel(role)}</strong></p><p><span>{t.channelAccess}</span><strong>{managerRole(role) ? t.allIncluded : t.noChannels}</strong></p></div>
      {reissuing && <p className={styles.warning}>{t.reissueWarning}</p>}
      <label className={styles.confirmField}><span>{t.confirmType.split('{code}')[0]}<code>{inviteConfirmation}</code>{t.confirmType.split('{code}')[1]}</span><input autoComplete="off" value={confirmation} disabled={busy} aria-label={t.inviteAria} onChange={event => setConfirmation(event.currentTarget.value)} /></label>
      {feedback?.error && <p ref={dialogFeedbackRef} tabIndex={-1} className={styles.error} role="alert">{feedback.text}</p>}
    </Dialog>

    <Dialog open={Boolean(revoking)} title={t.revokeTitle} description={revoking ? fill(t.revokeDetail, { email: revoking.email }) : undefined} onClose={closeDialogs} busy={busy} actions={<><Button data-dialog-cancel disabled={busy} onClick={closeDialogs}>{t.keepInvitation}</Button><Button variant="danger" disabled={busy || !revoking || confirmation !== revokeConfirmation} onClick={() => void revokeInvitation()}>{busy ? t.revoking : t.revokeInvitation}</Button></>}>
      {revoking && <><p className={styles.copy}>{t.revokeCopy}</p><label className={styles.confirmField}><span>{t.confirmType.split('{code}')[0]}<code>{revokeConfirmation}</code>{t.confirmType.split('{code}')[1]}</span><input autoComplete="off" value={confirmation} disabled={busy} aria-label={t.revokeAria} onChange={event => setConfirmation(event.currentTarget.value)} /></label>{feedback?.error && <p ref={dialogFeedbackRef} tabIndex={-1} className={styles.error} role="alert">{feedback.text}</p>}</>}
    </Dialog>
  </section>;
}
