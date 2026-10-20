'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/Button';
import { Dialog } from '@/components/Dialog';
import { FieldError, useFormValidation } from '@/components/FormValidation';
import styles from './invitations.module.css';

type Invitation = { id: string; email: string; role: string; expiresAt: string; acceptedAt: string | null; createdAt: string; status: 'pending' | 'expired' | 'accepted' };
type Delivery = 'sent' | 'failed' | 'uncertain' | 'unavailable';
type Feedback = { text: string; error: boolean };

const ROLES = ['owner', 'admin', 'editor', 'contributor', 'viewer', 'client'] as const;
const confirmationForInvite = (email: string) => `INVITE MEMBER ${email.trim().toLowerCase()}`;
const confirmationForRevoke = (id: string) => `REVOKE INVITATION ${id}`;
const managerRole = (role: string) => role === 'owner' || role === 'admin';
const roleLabel = (role: string) => role.charAt(0).toUpperCase() + role.slice(1);
const dateFormatter = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' });
function utcDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Date unavailable' : `${dateFormatter.format(date)} UTC`;
}

export function InvitationControls({ invitations, actorRole, available }: {
  invitations: Invitation[];
  actorRole: string;
  available: boolean;
}) {
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
    if (!canonicalEmail) errors.email = 'Enter the email address for the person you want to invite.';
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
        throw new Error(typeof payload.error === 'string' && payload.error.trim() ? payload.error : 'We could not confirm whether this invitation change completed. Refresh the invitation list before trying again.');
      }
      if (payload.ok !== true || typeof payload.id !== 'string' || !payload.id || (expectedId && payload.id !== expectedId)) {
        throw new Error('We could not confirm whether this invitation change completed. Refresh the invitation list before trying again.');
      }
      if (method === 'POST') {
        if (!['sent', 'failed', 'uncertain', 'unavailable'].includes(String(payload.delivery)) || typeof payload.expiresAt !== 'string') {
          throw new Error('The invitation may have been created, but its result was incomplete. Refresh the invitation list and check with the recipient before trying again.');
        }
        return { id: payload.id, delivery: payload.delivery as Delivery, expiresAt: payload.expiresAt };
      }
      if (payload.revoked !== true) throw new Error('We could not confirm whether the invitation was revoked. Refresh the invitation list before trying again.');
      return { id: payload.id };
    } catch (error) {
      if (!mounted.current || (error instanceof DOMException && error.name === 'AbortError')) return null;
      const message = responseReceived
        ? error instanceof Error ? error.message : 'The invitation could not be changed. Try again.'
        : 'We could not confirm whether this invitation change completed. Refresh the invitation list and check with the recipient before trying again.';
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
    const reissueCopy = reissuing ? ' The previous invitation link is no longer valid.' : '';
    const text = result.delivery === 'sent'
      ? `Invitation recorded for ${canonicalEmail}. The email was sent and expires ${expiry}.${reissueCopy}`
      : result.delivery === 'uncertain'
        ? `Invitation recorded for ${canonicalEmail}, but email delivery is unconfirmed. It may have been sent. Check with the recipient and invitation list before reissuing.${reissueCopy}`
        : result.delivery === 'failed'
          ? `Invitation recorded for ${canonicalEmail}, but the email was not delivered. You can reissue it after checking the address; reissuing invalidates the previous link.${reissueCopy}`
          : `Invitation recorded for ${canonicalEmail}, but email delivery is unavailable. The invitation remains in the list.${reissueCopy}`;
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
    setFeedback({ text: `Invitation for ${invitation.email} revoked.`, error: false });
    setRevoking(null);
    setConfirmation('');
    router.refresh();
  }

  return <section className={styles.invitations} aria-labelledby="team-invitations-heading">
    <div className={styles.heading}><div><h2 id="team-invitations-heading">Invitations</h2><p>Invite someone by email. They can join with an existing account or create one from the link. The link expires at the time shown below.</p></div></div>

    {canManage && !available && <p className={styles.unavailable} role="status">Invitations are unavailable right now. Existing invitations remain listed below.</p>}
    {canManage && available && <form method="post" noValidate className={styles.form} onSubmit={startInvite}>
      <div className={styles.fields}>
        <label className={styles.field} htmlFor="team-invitation-email">Email address
          <input id="team-invitation-email" name="email" type="email" autoComplete="email" required maxLength={320} value={email} disabled={busy} aria-invalid={validation.errors.email ? true : undefined} aria-describedby={validation.errors.email ? 'team-invitation-email-error' : 'team-invitation-email-help'} onChange={event => {
            const next = event.currentTarget.value;
            setEmail(next);
            validation.clear('email');
            if (reissuing && next.trim().toLowerCase() !== reissuing.email.trim().toLowerCase()) setReissuing(null);
            setConfirmation('');
          }} />
          {validation.errors.email ? <FieldError id="team-invitation-email-error">{validation.errors.email}</FieldError> : <span id="team-invitation-email-help" className={styles.hint}>They can use an existing account or create one when they accept.</span>}
        </label>
        <label className={styles.field}>Workspace role
          <select value={role} disabled={busy} onChange={event => { setRole(event.currentTarget.value as (typeof ROLES)[number]); setConfirmation(''); }}>
            {ROLES.filter(option => !(actorRole === 'admin' && option === 'owner')).map(option => <option key={option} value={option}>{roleLabel(option)}</option>)}
          </select>
        </label>
      </div>
      <p className={styles.scopeNote}>New members start with no channels selected. Owners and admins always have access to every channel.</p>
      {pendingForEmail && !reissuing && <p className={styles.warning} role="note">A pending invitation already exists for this address. Reissuing it will invalidate its current link.</p>}
      <div className={styles.actions}><Button variant="primary" type="submit" disabled={busy}>{pendingForEmail && !reissuing ? 'Review reissue' : 'Review invitation'}</Button></div>
    </form>}

    {feedback && !inviteReview && !revoking && <p ref={feedbackRef} tabIndex={-1} role={feedback.error ? 'alert' : 'status'} className={feedback.error ? styles.error : styles.success}>{feedback.text}</p>}

    {invitations.length === 0 ? <p className={styles.empty}>No invitations yet.</p> : <div className={styles.tableWrap} role="region" aria-label="Workspace invitations" tabIndex={0}>
      <table className={styles.table}>
        <caption className={styles.visuallyHidden}>Workspace invitations and their current status</caption>
        <thead><tr><th scope="col">Email</th><th scope="col">Role</th><th scope="col">Status</th><th scope="col">Expires</th><th scope="col"><span className={styles.visuallyHidden}>Invitation actions</span></th></tr></thead>
        <tbody>{invitations.map(invitation => <tr key={invitation.id}>
          <th scope="row">{invitation.email}</th>
          <td>{roleLabel(invitation.role)}</td>
          <td><span className={`${styles.status} ${styles[`status_${invitation.status}`]}`}>{roleLabel(invitation.status)}</span>{invitation.acceptedAt && <span className={styles.acceptedAt}>Accepted {utcDate(invitation.acceptedAt)}</span>}</td>
          <td>{utcDate(invitation.expiresAt)}</td>
          <td><div className={styles.rowActions}>
            {canManage && invitation.status !== 'accepted' && (actorRole === 'owner' || invitation.role !== 'owner') && <Button size="sm" disabled={busy || !available} onClick={() => beginReissue(invitation)}>Reissue</Button>}
            {canManage && invitation.status === 'pending' && <Button size="sm" variant="quiet" disabled={busy} onClick={() => { setRevoking(invitation); setConfirmation(''); setFeedback(null); }}>Revoke</Button>}
            {!canManage && <span className={styles.hint}>View only</span>}
          </div></td>
        </tr>)}</tbody>
      </table>
    </div>}

    <Dialog open={inviteReview} title={reissuing ? 'Review invitation reissue' : 'Review invitation'} description={`Invite ${canonicalEmail} as ${roleLabel(role)}.`} onClose={closeDialogs} busy={busy} actions={<><Button data-dialog-cancel disabled={busy} onClick={closeDialogs}>Back</Button><Button variant="primary" disabled={busy || confirmation !== inviteConfirmation} onClick={() => void createInvitation()}>{busy ? 'Creating invitation…' : reissuing ? 'Reissue invitation' : 'Create invitation'}</Button></>}>
      <div className={styles.review}><p><span>Email</span><strong>{canonicalEmail}</strong></p><p><span>Workspace role</span><strong>{roleLabel(role)}</strong></p><p><span>Channel access</span><strong>{managerRole(role) ? 'All channels (included with this role)' : 'No channels selected'}</strong></p></div>
      {reissuing && <p className={styles.warning}>Continuing creates a fresh invitation and invalidates the previous link. The previous link cannot be used after this change.</p>}
      <label className={styles.confirmField}><span>Type <code>{inviteConfirmation}</code> to confirm</span><input autoComplete="off" value={confirmation} disabled={busy} aria-label="INVITE confirmation" onChange={event => setConfirmation(event.currentTarget.value)} /></label>
      {feedback?.error && <p ref={dialogFeedbackRef} tabIndex={-1} className={styles.error} role="alert">{feedback.text}</p>}
    </Dialog>

    <Dialog open={Boolean(revoking)} title="Revoke invitation" description={revoking ? `Stop ${revoking.email} from using this invitation?` : undefined} onClose={closeDialogs} busy={busy} actions={<><Button data-dialog-cancel disabled={busy} onClick={closeDialogs}>Keep invitation</Button><Button variant="danger" disabled={busy || !revoking || confirmation !== revokeConfirmation} onClick={() => void revokeInvitation()}>{busy ? 'Revoking…' : 'Revoke invitation'}</Button></>}>
      {revoking && <><p className={styles.copy}>This prevents the pending invitation from being accepted. The person’s account and access to other workspaces are unaffected.</p><label className={styles.confirmField}><span>Type <code>{revokeConfirmation}</code> to confirm</span><input autoComplete="off" value={confirmation} disabled={busy} aria-label="REVOKE confirmation" onChange={event => setConfirmation(event.currentTarget.value)} /></label>{feedback?.error && <p ref={dialogFeedbackRef} tabIndex={-1} className={styles.error} role="alert">{feedback.text}</p>}</>}
    </Dialog>
  </section>;
}
