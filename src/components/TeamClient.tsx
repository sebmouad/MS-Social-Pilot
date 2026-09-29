'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

/** Ordered strongest first, so a position in this list is a rank. */
const ROLES = ['owner', 'admin', 'editor', 'contributor'] as const;

export interface Member {
  userId: string;
  name: string;
  email: string;
  role: string;
  isSelf: boolean;
}

export interface PendingInvitation {
  id: string;
  email: string;
  role: string;
  expiresLabel: string;
}

interface Props {
  members: Member[];
  invitations: PendingInvitation[];
  canManage: boolean;
  /** The viewer's own role. Nobody is offered a role above it. */
  viewerRole: string;
  /** False when RESEND_API_KEY is unset — the link is shown instead. */
  emailConfigured: boolean;
}

export function TeamClient({ members, invitations, canManage, viewerRole, emailConfigured }: Props) {
  const t = useTranslations('team');
  const tCommon = useTranslations('common');
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [role, setRole] = useState<string>('contributor');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [manualLink, setManualLink] = useState<string | null>(null);
  /**
   * The members and invitations a change is in flight for.
   *
   * A set rather than one id, because two rows can be changed at once and the
   * first to finish must not unlock the other. Every control for a row is
   * disabled until its answer comes back. Without the
   * lock a second pick in the role menu races the first, and whichever request
   * lands last wins — not necessarily the one the admin chose last.
   */
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  /**
   * A confirmed role change, shown until the refreshed member list arrives.
   *
   * The select is controlled by the stored role, so without this it would
   * snap back to the old one while the request is out, which reads as the
   * change having been refused.
   */
  const [requested, setRequested] = useState<{ userId: string; role: string } | null>(null);
  useEffect(() => setRequested(null), [members]);

  // The API refuses to grant or withdraw a role above the caller's own, so an
  // admin is not shown an "owner" option that would come back a 403, and is not
  // offered the controls for a member standing above them.
  const viewerRank = ROLES.indexOf(viewerRole as (typeof ROLES)[number]);
  const grantable = viewerRank < 0 ? [] : ROLES.slice(viewerRank);
  const canManageMember = (member: Member) =>
    canManage && !member.isSelf && ROLES.indexOf(member.role as (typeof ROLES)[number]) >= viewerRank;

  async function invite() {
    setPending(true);
    setError(null);
    setEmailError(false);
    setNotice(null);
    setManualLink(null);

    try {
      const response = await fetch('/api/team', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, role }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        fields?: Record<string, string>;
        emailSent?: boolean;
        acceptUrl?: string;
      };

      if (!response.ok) {
        // The server's field message is English whatever the reader's language,
        // and only the address can be wrong here, so say so in our own words
        // next to the field rather than "correct the highlighted fields" with
        // nothing highlighted.
        if (body.fields?.email) {
          setEmailError(true);
        } else {
          setError(body.error ?? t('inviteFailed'));
        }
        return;
      }

      setNotice(t('inviteSent', { email }));
      // Without a mail provider the invitation still exists, so surface the
      // link rather than leaving the admin with no way to pass it on.
      if (!body.emailSent && body.acceptUrl) setManualLink(body.acceptUrl);
      setEmail('');
      router.refresh();
    } catch {
      setError(t('networkError'));
    } finally {
      setPending(false);
    }
  }

  /** Resolves true when the server accepted the change. */
  async function call(id: string, path: string, init: RequestInit): Promise<boolean> {
    setBusy((current) => new Set(current).add(id));
    setError(null);
    try {
      const response = await fetch(path, init);
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? t('actionFailed'));
        return false;
      }
      router.refresh();
      return true;
    } catch {
      setError(t('networkError'));
      return false;
    } finally {
      setBusy((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }
  }

  /**
   * Asked first, because a role is access: one mis-click in a menu can hand
   * somebody the instance configuration, or take a co-owner's away, and the
   * select gives no other moment to notice.
   */
  function changeRole(member: Member, next: string) {
    if (next === member.role) return;

    const question = [
      t('roleChangeConfirm', {
        name: member.name,
        from: t(`roles.${member.role}`),
        to: t(`roles.${next}`),
      }),
      next === 'owner' ? t('roleToOwnerWarning') : member.role === 'owner' ? t('roleFromOwnerWarning') : null,
    ]
      .filter(Boolean)
      .join('\n\n');

    // Cancelling needs no undo: the select is controlled by the member's
    // stored role, so it snaps back on the next render.
    if (!window.confirm(question)) return;

    setRequested({ userId: member.userId, role: next });
    void call(member.userId, `/api/team/${member.userId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ role: next }),
    }).then((accepted) => {
      if (!accepted) setRequested(null);
    });
  }

  return (
    <div className="space-y-6">
      {error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}
      {notice && (
        <div
          role="status"
          className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700"
        >
          <p>{notice}</p>
          {manualLink && (
            <p className="mt-1 break-all text-xs">
              {t('shareLink')} <code className="rounded bg-white px-1">{manualLink}</code>
            </p>
          )}
        </div>
      )}

      {canManage && (
        <section className="card p-5">
          <h2 className="text-sm font-semibold text-slate-900">{t('invite')}</h2>
          {/* Said before the invitation is sent, not after: somebody expecting
              an email to go out would otherwise tell their colleague to watch
              for one that never comes. */}
          {!emailConfigured && (
            <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {t('emailNotConfigured')}
            </p>
          )}
          <div className="mt-4 flex flex-wrap items-end gap-2">
            <div className="min-w-0 flex-1 basis-64">
              <label className="label" htmlFor="inviteEmail">
                {t('inviteEmail')}
              </label>
              <input
                id="inviteEmail"
                type="email"
                className="input"
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                  setEmailError(false);
                }}
                placeholder="colleague@example.com"
                aria-invalid={emailError || undefined}
                aria-describedby={emailError ? 'inviteEmail-error' : undefined}
              />
              {emailError && (
                <p id="inviteEmail-error" className="error-text">
                  {t('invalidEmail')}
                </p>
              )}
            </div>
            <div>
              <label className="label" htmlFor="inviteRole">
                {t('role')}
              </label>
              <select
                id="inviteRole"
                className="input"
                value={role}
                onChange={(event) => setRole(event.target.value)}
              >
                {grantable
                  .filter((option) => option !== 'owner')
                  .map((option) => (
                    <option key={option} value={option}>
                      {t(`roles.${option}`)}
                    </option>
                  ))}
              </select>
            </div>
            <button
              type="button"
              className="btn-primary"
              disabled={pending || !email.trim()}
              onClick={invite}
            >
              {pending ? tCommon('working') : t('sendInvite')}
            </button>
          </div>
          <p className="hint">{t(`roleHints.${role}`)}</p>
        </section>
      )}

      {invitations.length > 0 && (
        <section className="card p-5">
          <h2 className="text-sm font-semibold text-slate-900">{t('pendingInvites')}</h2>
          <ul className="mt-3 divide-y divide-slate-100">
            {invitations.map((invitation) => (
              <li key={invitation.id} className="flex flex-wrap items-center gap-3 py-2.5">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-slate-900">{invitation.email}</span>
                  <span className="text-xs text-slate-500">
                    {t(`roles.${invitation.role}`)} · {t('expires', { when: invitation.expiresLabel })}
                  </span>
                </span>
                {canManage && (
                  <button
                    type="button"
                    className="btn-danger"
                    aria-label={t('revokeNamed', { email: invitation.email })}
                    disabled={busy.has(invitation.id)}
                    onClick={() =>
                      call(invitation.id, `/api/team/${invitation.id}?type=invitation`, { method: 'DELETE' })
                    }
                  >
                    {t('revoke')}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card p-5">
        <h2 className="text-sm font-semibold text-slate-900">{t('members')}</h2>
        <ul className="mt-3 divide-y divide-slate-100">
          {members.map((member) => (
            <li key={member.userId} className="flex flex-wrap items-center gap-3 py-2.5">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-slate-900">
                  {member.name}
                  {member.isSelf && <span className="ml-1 text-xs text-slate-400">({t('you')})</span>}
                </span>
                <span className="block truncate text-xs text-slate-500">{member.email}</span>
              </span>

              {canManageMember(member) ? (
                <>
                  <select
                    className="rounded-lg border border-slate-300 px-2 py-1 text-xs"
                    aria-label={t('memberRole', { name: member.name })}
                    value={requested?.userId === member.userId ? requested.role : member.role}
                    disabled={busy.has(member.userId)}
                    onChange={(event) => changeRole(member, event.target.value)}
                  >
                    {grantable.map((option) => (
                      <option key={option} value={option}>
                        {t(`roles.${option}`)}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="btn-danger"
                    aria-label={t('removeMemberNamed', { name: member.name })}
                    disabled={busy.has(member.userId)}
                    onClick={() => {
                      if (window.confirm(t('removeConfirm', { name: member.name }))) {
                        void call(member.userId, `/api/team/${member.userId}`, { method: 'DELETE' });
                      }
                    }}
                  >
                    {t('removeMember')}
                  </button>
                </>
              ) : (
                <span className="text-xs text-slate-500">{t(`roles.${member.role}`)}</span>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
