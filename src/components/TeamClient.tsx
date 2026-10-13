'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

import { useConfirm } from './ConfirmProvider';

import { Dialog } from './Dialog';
import { FeedAvatar } from './FeedPost';
import { Icon } from './Icon';
import { paletteOf } from '@/lib/palette';

/** Ordered strongest first, so a position in this list is a rank. */
const ROLES = ['owner', 'admin', 'editor', 'contributor', 'viewer', 'client'] as const;

export interface Member {
  userId: string;
  name: string;
  email: string;
  role: string;
  isSelf: boolean;
  /** Every Page, or only `pageIds`. Owners and admins always have every one. */
  allPages?: boolean;
  pageIds?: string[];
}

interface PageOption {
  id: string;
  name: string;
  pictureUrl: string | null;
}

interface GroupOption {
  id: string;
  name: string;
  color: string;
  targetIds: string[];
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
  /** False when no email provider is configured — the link is shown instead. */
  emailConfigured: boolean;
  /** The workspace's Pages and groups, for limiting a member to some. */
  pages?: PageOption[];
  groups?: GroupOption[];
}

const SEES_ALL = new Set(['owner', 'admin']);

export function TeamClient({ members, invitations, canManage, viewerRole, emailConfigured, pages = [], groups = [] }: Props) {
  const t = useTranslations('team');
  const tCommon = useTranslations('common');
  const confirm = useConfirm();
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

  /** The member whose Pages are being chosen, and the choice so far. */
  const [access, setAccess] = useState<{ member: Member; all: boolean; ids: string[] } | null>(null);
  const closeAccess = useCallback(() => setAccess(null), []);

  async function saveAccess() {
    if (!access) return;
    const ok = await call(access.member.userId, `/api/team/${access.member.userId}`, {
      method: 'PATCH',
      body: JSON.stringify({ pages: { all: access.all, targetIds: access.ids } }),
    });
    if (ok) {
      setNotice(
        access.all
          ? t('accessAllSaved', { name: access.member.name })
          : t('accessSomeSaved', { name: access.member.name, count: access.ids.length }),
      );
      setAccess(null);
    }
  }

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

    // Several addresses at once, separated by commas, spaces or new lines.
    const emails = [...new Set(email.split(/[\s,;]+/).map((entry) => entry.trim()).filter(Boolean))];

    try {
      const sent: string[] = [];
      const refused: string[] = [];
      let lastLink: string | null = null;
      let firstError: string | null = null;
      for (const address of emails) {
        const response = await fetch('/api/team', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email: address, role }),
        });
        const body = (await response.json().catch(() => ({}))) as {
          error?: string;
          fields?: Record<string, string>;
          emailSent?: boolean;
          acceptUrl?: string;
        };
        if (!response.ok) {
          // The server's field message is English whatever the reader's
          // language, and only the address can be wrong here, so say so in our
          // own words rather than "correct the highlighted fields".
          if (body.fields?.email) setEmailError(true);
          else firstError ??= body.error ?? t('inviteFailed');
          refused.push(address);
          continue;
        }
        sent.push(address);
        // Without a mail provider the invitation still exists, so surface the
        // link rather than leaving the admin with no way to pass it on.
        if (!body.emailSent && body.acceptUrl) lastLink = body.acceptUrl;
      }

      if (sent.length > 0) {
        setNotice(sent.length === 1 ? t('inviteSent', { email: sent[0]! }) : t('inviteSentMany', { count: sent.length }));
        if (lastLink && sent.length === 1) setManualLink(lastLink);
        router.refresh();
      }
      if (refused.length > 0) {
        if (firstError) setError(emails.length > 1 ? t('inviteSomeFailed', { emails: refused.join(', ') }) : firstError);
        // Keep what was not sent, to correct and try again.
        setEmail(refused.join(', '));
      } else {
        setEmail('');
      }
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
  async function changeRole(member: Member, next: string) {
    if (next === member.role) return;

    const warning = next === 'owner' ? t('roleToOwnerWarning') : member.role === 'owner' ? t('roleFromOwnerWarning') : undefined;

    // Cancelling needs no undo: the select is controlled by the member's
    // stored role, so it snaps back on the next render.
    if (
      !(await confirm({
        title: t('roleChangeConfirm', { name: member.name, from: t(`roles.${member.role}`), to: t(`roles.${next}`) }),
        body: warning,
        confirmLabel: t('roleChangeAction', { role: t(`roles.${next}`) }),
      }))
    )
      return;

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
                type="text"
                inputMode="email"
                autoComplete="off"
                className="input"
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                  setEmailError(false);
                }}
                placeholder={t('invitePlaceholder')}
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
                  {member.isSelf && <span className="ms-1 text-xs text-slate-400">({t('you')})</span>}
                </span>
                <span className="block truncate text-xs text-slate-500">{member.email}</span>
              </span>

              {pages.length > 0 && (
                <PagesBadge
                  member={member}
                  editable={canManageMember(member) && !SEES_ALL.has(member.role)}
                  busy={busy.has(member.userId)}
                  onEdit={() => setAccess({ member, all: member.allPages ?? true, ids: member.pageIds ?? [] })}
                  label={
                    SEES_ALL.has(member.role) || member.allPages !== false
                      ? t('accessAll')
                      : t('accessSome', { count: member.pageIds?.length ?? 0 })
                  }
                  editLabel={t('accessEdit', { name: member.name })}
                />
              )}
              {canManageMember(member) ? (
                <>
                  <select
                    className="input-sm"
                    aria-label={t('memberRole', { name: member.name })}
                    value={requested?.userId === member.userId ? requested.role : member.role}
                    disabled={busy.has(member.userId)}
                    onChange={(event) => changeRole(member, event.target.value)}
                  >
                    {/* A client stays a client; the team never becomes one. */}
                    {(member.role === 'client' ? ['client'] : grantable.filter((option) => option !== 'client')).map((option) => (
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
                    onClick={async () => {
                      if (await confirm({ title: t('removeConfirm', { name: member.name }), danger: true, confirmLabel: tCommon('remove') })) {
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

      <Dialog
        open={access !== null}
        title={access ? t('accessTitle', { name: access.member.name }) : ''}
        onClose={closeAccess}
        closeLabel={tCommon('close')}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={closeAccess}>
              {tCommon('cancel')}
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={!access || busy.has(access.member.userId) || (!access.all && access.ids.length === 0)}
              onClick={() => void saveAccess()}
            >
              {tCommon('save')}
            </button>
          </>
        }
      >
        {access && (
          <div className="space-y-4">
            <div role="radiogroup" aria-label={t('accessTitle', { name: access.member.name })} className="space-y-2">
              {[
                { all: true, title: t('accessAllTitle'), hint: t('accessAllHint') },
                { all: false, title: t('accessSomeTitle'), hint: t('accessSomeHint') },
              ].map((option) => (
                <label
                  key={String(option.all)}
                  className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 ${
                    access.all === option.all ? 'border-brand-400 bg-brand-50/60' : 'border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <input
                    type="radio"
                    name="page-access"
                    className="mt-0.5 h-4 w-4 border-slate-300 text-brand-500 focus:ring-brand-500"
                    checked={access.all === option.all}
                    onChange={() => setAccess({ ...access, all: option.all })}
                  />
                  <span>
                    <span className="block text-sm font-semibold text-slate-900">{option.title}</span>
                    <span className="block text-xs text-slate-600">{option.hint}</span>
                  </span>
                </label>
              ))}
            </div>

            {!access.all && (
              <div className="space-y-2">
                {groups.length > 0 && (
                  <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('accessByGroup')}>
                    {groups.map((group) => {
                      const on = group.targetIds.length > 0 && group.targetIds.every((id) => access.ids.includes(id));
                      return (
                        <button
                          key={group.id}
                          type="button"
                          aria-pressed={on}
                          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${
                            on ? paletteOf(group.color).chip : 'bg-white text-slate-700 ring-slate-200 hover:bg-slate-50'
                          }`}
                          onClick={() =>
                            setAccess({
                              ...access,
                              ids: on
                                ? access.ids.filter((id) => !group.targetIds.includes(id))
                                : [...new Set([...access.ids, ...group.targetIds])],
                            })
                          }
                        >
                          <span aria-hidden className={`h-2 w-2 rounded-full ${paletteOf(group.color).dot}`} />
                          {group.name}
                        </button>
                      );
                    })}
                  </div>
                )}
                <ul className="max-h-72 space-y-0.5 overflow-y-auto rounded-lg border border-slate-200 p-1.5">
                  {pages.map((page) => {
                    const on = access.ids.includes(page.id);
                    return (
                      <li key={page.id}>
                        <label className={`flex cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 ${on ? 'bg-brand-50' : 'hover:bg-slate-50'}`}>
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded border-slate-300 text-brand-500 focus:ring-brand-500"
                            checked={on}
                            onChange={() =>
                              setAccess({ ...access, ids: on ? access.ids.filter((id) => id !== page.id) : [...access.ids, page.id] })
                            }
                          />
                          <FeedAvatar name={page.name} pictureUrl={page.pictureUrl} size="sm" />
                          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-900">{page.name}</span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
                <p className="hint">{t('accessCount', { count: access.ids.length, total: pages.length })}</p>
              </div>
            )}
          </div>
        )}
      </Dialog>
    </div>
  );
}

/** Which Pages a member works on, as a chip that opens the chooser. */
function PagesBadge({
  member,
  editable,
  busy,
  onEdit,
  label,
  editLabel,
}: {
  member: Member;
  editable: boolean;
  busy: boolean;
  onEdit: () => void;
  label: string;
  editLabel: string;
}) {
  const limited = member.allPages === false && !SEES_ALL.has(member.role);
  const look = `inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
    limited ? 'bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200' : 'bg-slate-100 text-slate-700'
  }`;
  return editable ? (
    <button type="button" className={`${look} hover:brightness-95`} aria-label={editLabel} disabled={busy} onClick={onEdit}>
      <Icon name="folders" size={13} />
      {label}
      <Icon name="pencil" size={12} />
    </button>
  ) : (
    <span className={look}>
      <Icon name="folders" size={13} />
      {label}
    </span>
  );
}
