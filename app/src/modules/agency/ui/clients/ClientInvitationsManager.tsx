'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { IconMailPlus, IconTrash } from '@tabler/icons-react';
import { Button } from '@/components/Button';
import { DataTable } from '@/components/DataTable';
import { Badge } from '@/components/Badge';
import { useConfirm } from '@/components/useConfirm';
import { clientInviteConfirmation, clientRevokeConfirmation, type ClientInvitationCopy } from '../../invitation-policy';
import type { listClientInvitations, ClientInvitationSummary } from '../../server/client-invitations';
import { createClientInvitation, reloadClientInvitations, removeClientInvitation } from './invitation-actions';
import styles from './invitations.module.css';

type Directory = Awaited<ReturnType<typeof listClientInvitations>>;

/** Private Root control: the caller supplies an authorized directory and runtime-selected catalog. */
export function ClientInvitationsManager({ initial, copy, locale }: { initial: Directory; copy: ClientInvitationCopy; locale: 'en' | 'fr' }) {
  const [directory, setDirectory] = useState(initial);
  const [email, setEmail] = useState('');
  const [workspaceName, setWorkspaceName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [link, setLink] = useState('');
  const pending = useRef(false);
  const feedback = useRef<HTMLParagraphElement>(null);
  const [askCreate, createDialog] = useConfirm({ title: copy.create, cancel: copy.cancel, confirm: copy.create, danger: false });
  const [askRevoke, revokeDialog] = useConfirm({ title: copy.revoke, cancel: copy.cancel, confirm: copy.revoke });
  useEffect(() => { if (notice || error) feedback.current?.focus(); }, [notice, error]);

  async function reload() {
    try { setDirectory(await reloadClientInvitations()); setError(''); }
    catch { setError(copy.failed); }
  }
  async function exclusive(run: () => Promise<string | null>) {
    if (pending.current) return copy.pending;
    pending.current = true; setBusy(true);
    try { return await run(); }
    catch { return copy.failed; }
    finally { pending.current = false; setBusy(false); }
  }
  async function invite(event: FormEvent) {
    event.preventDefault();
    if (busy || link) return;
    const normalizedEmail = email.trim().toLowerCase();
    const name = workspaceName.trim();
    const confirmation = clientInviteConfirmation(normalizedEmail, name || null);
    await askCreate(`${normalizedEmail}${name ? ` · ${name}` : ''}\n\n${copy.createNotice}`, {
      exactConfirmation: confirmation, confirmationLabel: copy.exact, pendingLabel: copy.pending, failureLabel: copy.failed,
      onConfirm: () => exclusive(async () => {
        const result = await createClientInvitation({ email: normalizedEmail, workspaceName: name, locale, confirmation });
        if (result.created !== true || !result.id || !result.url || !['sent', 'unavailable', 'failed', 'uncertain'].includes(result.delivery)) return copy.failed;
        setLink(result.url); setEmail(''); setWorkspaceName('');
        setNotice(`${copy.created} ${result.delivery === 'sent' ? copy.sent : copy.mailUnavailable}`);
        // A failed refresh never changes a confirmed creation into a repeatable failed write.
        await reload();
        return null;
      }),
    });
  }
  async function revoke(invitation: ClientInvitationSummary) {
    if (busy || invitation.status === 'accepted') return;
    const confirmation = clientRevokeConfirmation(invitation.id);
    await askRevoke(`${invitation.email}\n\n${copy.revokeNotice}`, {
      exactConfirmation: confirmation, confirmationLabel: copy.exact, pendingLabel: copy.pending, failureLabel: copy.failed,
      onConfirm: () => exclusive(async () => {
        const result = await removeClientInvitation({ id: invitation.id, confirmation });
        if (result.revoked !== true || result.id !== invitation.id) return copy.failed;
        setDirectory(current => ({ ...current, invitations: current.invitations.filter(item => item.id !== invitation.id) }));
        setNotice(copy.revoked); await reload();
        return null;
      }),
    });
  }
  return <section className={styles.root} aria-label={copy.title} data-module="agency">
    <div className={styles.heading}><div><h2>{copy.title}</h2><p>{copy.help}</p></div><Button variant="secondary" disabled={busy} onClick={() => void exclusive(async () => { await reload(); return null; })}>{copy.retry}</Button></div>
    {directory.policy.enabled ? <form className={styles.form} onSubmit={invite} aria-label={copy.create}>
      <label className="ui-field"><span>{copy.email}</span><input className="ui-input" type="email" name="email" autoComplete="email" spellCheck={false} required maxLength={directory.policy.emailMaxLength} value={email} disabled={busy || Boolean(link)} onChange={event => setEmail(event.target.value)} /></label>
      <label className="ui-field"><span>{copy.workspaceName} <span className={styles.muted}>({copy.optional})</span></span><input className="ui-input" name="workspaceName" autoComplete="off" maxLength={directory.policy.workspaceNameMaxLength} value={workspaceName} disabled={busy || Boolean(link)} onChange={event => setWorkspaceName(event.target.value)} /></label>
      <Button type="submit" variant="primary" leading={<IconMailPlus size={18} aria-hidden="true" />} disabled={busy || Boolean(link)}>{copy.create}</Button>
    </form> : <p className={styles.muted}>{copy.disabled}</p>}
    {link && <div className={styles.receipt}><label className="ui-field"><span>{copy.link}</span><textarea className="ui-input" readOnly value={link} spellCheck={false} autoComplete="off" /></label><Button variant="secondary" disabled={busy} onClick={() => setLink('')}>{copy.hideLink}</Button></div>}
    {(notice || error) && <p ref={feedback} tabIndex={-1} role={error ? 'alert' : 'status'} className={styles.feedback}>{notice}{error && <span className="ui-error"> {error}</span>}</p>}
    {directory.truncated && <p role="status" className={styles.muted}>{copy.truncated}</p>}
    <DataTable caption={copy.title} rows={directory.invitations} rowKey={item => item.id} emptyMessage={copy.empty} zebra={false} columns={[
      { key: 'client', label: copy.email, render: item => <span className={styles.identity}><strong>{item.email}</strong>{item.workspaceName && <span>{item.workspaceName}</span>}</span> },
      { key: 'status', label: copy.status, render: item => <Badge tone={item.status === 'expired' ? 'warning' : 'neutral'}>{item.status === 'accepted' ? copy.accepted : item.status === 'expired' ? copy.expired : copy.active}</Badge> },
      { key: 'expires', label: copy.expires, render: item => <time dateTime={item.expiresAt}>{new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(item.expiresAt))}</time> },
      { key: 'action', label: copy.revoke, render: item => item.status !== 'accepted' ? <Button variant="quiet" disabled={busy} leading={<IconTrash size={16} aria-hidden="true" />} aria-label={`${copy.revoke} ${item.email}`} onClick={() => void revoke(item)}>{copy.revoke}</Button> : null },
    ]} />
    {createDialog}{revokeDialog}
  </section>;
}
