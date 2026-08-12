'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
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
  const [notice, setNotice] = useState<string | null>(null);
  const [manualLink, setManualLink] = useState<string | null>(null);

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
    setNotice(null);
    setManualLink(null);

    const response = await fetch('/api/team', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, role }),
    });
    const body = (await response.json().catch(() => ({}))) as {
      error?: string;
      emailSent?: boolean;
      acceptUrl?: string;
    };

    if (!response.ok) {
      setError(body.error ?? 'Could not send that invitation.');
    } else {
      setNotice(t('inviteSent', { email }));
      // Without a mail provider the invitation still exists, so surface the
      // link rather than leaving the admin with no way to pass it on.
      if (!body.emailSent && body.acceptUrl) setManualLink(body.acceptUrl);
      setEmail('');
      router.refresh();
    }
    setPending(false);
  }

  async function call(path: string, init: RequestInit) {
    setError(null);
    const response = await fetch(path, init);
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? 'That did not work.');
      return;
    }
    router.refresh();
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      )}
      {notice && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          <p>{notice}</p>
          {manualLink && (
            <p className="mt-1 break-all text-xs">
              {!emailConfigured && 'Email is not configured on this server. Share this link: '}
              <code className="rounded bg-white px-1">{manualLink}</code>
            </p>
          )}
        </div>
      )}

      {canManage && (
        <section className="card p-5">
          <h2 className="text-sm font-semibold text-slate-900">{t('invite')}</h2>
          <div className="mt-4 flex flex-wrap items-end gap-2">
            <div className="min-w-[16rem] flex-1">
              <label className="label" htmlFor="inviteEmail">
                {t('inviteEmail')}
              </label>
              <input
                id="inviteEmail"
                type="email"
                className="input"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="colleague@example.com"
              />
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
                    onClick={() =>
                      call(`/api/team/${invitation.id}?type=invitation`, { method: 'DELETE' })
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
                    value={member.role}
                    onChange={(event) =>
                      call(`/api/team/${member.userId}`, {
                        method: 'PATCH',
                        headers: { 'content-type': 'application/json' },
                        body: JSON.stringify({ role: event.target.value }),
                      })
                    }
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
                    onClick={() => {
                      if (window.confirm(t('removeConfirm', { name: member.name }))) {
                        call(`/api/team/${member.userId}`, { method: 'DELETE' });
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
