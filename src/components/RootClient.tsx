'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';

import { useConfirm } from './ConfirmProvider';
import { Icon } from './Icon';

/** One call to a root API route; the error text comes from the server, already translated. */
async function call(url: string, method: string, body?: unknown): Promise<string | null> {
  try {
    const response = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (response.ok) return null;
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    return data.error ?? `HTTP ${response.status}`;
  } catch {
    return 'network';
  }
}

function useAction() {
  const router = useRouter();
  const t = useTranslations('root');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function run(key: string, url: string, method: string, body?: unknown, success?: string) {
    setBusy(key);
    setError(null);
    setDone(null);
    const failure = await call(url, method, body);
    setBusy(null);
    if (failure) {
      setError(failure === 'network' ? t('networkError') : failure);
      return false;
    }
    if (success) setDone(success);
    router.refresh();
    return true;
  }

  const messages = (
    <>
      {error && (
        <p role="alert" className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <Icon name="error" size={14} /> {error}
        </p>
      )}
      {done && (
        <p role="status" className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          <Icon name="check" size={14} /> {done}
        </p>
      )}
    </>
  );
  return { busy, run, messages };
}

export interface RootWorkspace {
  id: string;
  name: string;
  createdAt: string;
  members: number;
  pages: number;
  posts: number;
  owners: string[];
  suspended: boolean;
}

export function WorkspacesTable({ workspaces }: { workspaces: RootWorkspace[] }) {
  const t = useTranslations('root');
  const format = useFormatter();
  const { busy, run, messages } = useAction();
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [newName, setNewName] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');

  return (
    <div className="space-y-3">
      {messages}
      <form
        className="card flex flex-wrap items-end gap-2 p-4"
        onSubmit={async (event) => {
          event.preventDefault();
          if (await run('create', '/api/root/workspaces', 'POST', { name: newName, ownerEmail }, t('workspaces.createdDone', { name: newName }))) {
            setNewName('');
            setOwnerEmail('');
          }
        }}
      >
        <label className="flex-1 text-sm">
          <span className="font-medium text-slate-700">{t('workspaces.newName')}</span>
          <input className="input mt-1" required maxLength={100} value={newName} onChange={(event) => setNewName(event.target.value)} />
        </label>
        <label className="flex-1 text-sm">
          <span className="font-medium text-slate-700">{t('workspaces.ownerEmail')}</span>
          <input className="input mt-1" type="email" required value={ownerEmail} onChange={(event) => setOwnerEmail(event.target.value)} />
        </label>
        <button type="submit" className="btn-primary h-10" disabled={busy === 'create'}>
          {t('workspaces.create')}
        </button>
      </form>
      <div className="card scroll-x p-0">
        <table className="w-full min-w-[40rem] text-start text-sm tabular-nums">
          <thead className="border-b border-slate-200 text-xs text-slate-500">
            <tr>
              <th className="px-4 py-2 font-medium">{t('workspaces.name')}</th>
              <th className="px-4 py-2 font-medium">{t('workspaces.owners')}</th>
              <th className="px-4 py-2 text-end font-medium">{t('workspaces.members')}</th>
              <th className="px-4 py-2 text-end font-medium">{t('workspaces.pages')}</th>
              <th className="px-4 py-2 text-end font-medium">{t('workspaces.posts')}</th>
              <th className="px-4 py-2 font-medium">{t('workspaces.created')}</th>
              <th className="px-4 py-2"><span className="sr-only">{t('actions')}</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {workspaces.map((workspace) => (
              <tr key={workspace.id}>
                <td className="px-4 py-2">
                  {editing === workspace.id ? (
                    <form
                      className="flex gap-1"
                      onSubmit={async (event) => {
                        event.preventDefault();
                        if (await run(workspace.id, `/api/root/workspaces/${workspace.id}`, 'PATCH', { name }, t('workspaces.renamed'))) {
                          setEditing(null);
                        }
                      }}
                    >
                      <label className="sr-only" htmlFor={`rename-${workspace.id}`}>{t('workspaces.name')}</label>
                      <input
                        id={`rename-${workspace.id}`}
                        className="input h-9"
                        value={name}
                        maxLength={100}
                        autoComplete="off"
                        onChange={(event) => setName(event.target.value)}
                      />
                      <button type="submit" className="btn-primary h-9" disabled={busy === workspace.id || !name.trim()}>
                        {t('save')}
                      </button>
                      <button type="button" className="btn-ghost h-9" onClick={() => setEditing(null)}>
                        {t('cancel')}
                      </button>
                    </form>
                  ) : (
                    <span className="flex flex-wrap items-center gap-2">
                      <Link href={`/root/workspaces/${workspace.id}`} className="font-semibold text-brand-700 hover:underline">
                        {workspace.name}
                      </Link>
                      {workspace.suspended && <span className="badge bg-red-100 text-red-700">{t('workspace.suspendedBadge')}</span>}
                    </span>
                  )}
                </td>
                <td className="px-4 py-2 text-slate-600">{workspace.owners.join(', ') || '—'}</td>
                <td className="px-4 py-2 text-end">{format.number(workspace.members)}</td>
                <td className="px-4 py-2 text-end">{format.number(workspace.pages)}</td>
                <td className="px-4 py-2 text-end">{format.number(workspace.posts)}</td>
                <td className="px-4 py-2 text-slate-600">{format.dateTime(new Date(workspace.createdAt), { dateStyle: 'medium' })}</td>
                <td className="px-4 py-2 text-end">
                  {editing !== workspace.id && (
                    <button
                      type="button"
                      className="btn-ghost h-9"
                      onClick={() => {
                        setEditing(workspace.id);
                        setName(workspace.name);
                      }}
                    >
                      <Icon name="pencil" size={14} /> {t('workspaces.rename')}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export interface RootUser {
  id: string;
  email: string;
  name: string;
  isRoot: boolean;
  disabled: boolean;
  createdAt: string;
  lastSignIn: string | null;
  memberships: Array<{ workspace: string; role: string }>;
}

export function UsersTable({ users }: { users: RootUser[] }) {
  const t = useTranslations('root');
  const tRoles = useTranslations('team.roles');
  const format = useFormatter();
  const confirm = useConfirm();
  const { busy, run, messages } = useAction();

  return (
    <div className="space-y-3">
      {messages}
      <div className="card scroll-x p-0">
        <table className="w-full min-w-[44rem] text-start text-sm">
          <thead className="border-b border-slate-200 text-xs text-slate-500">
            <tr>
              <th className="px-4 py-2 font-medium">{t('users.person')}</th>
              <th className="px-4 py-2 font-medium">{t('users.workspaces')}</th>
              <th className="px-4 py-2 font-medium">{t('users.lastSignIn')}</th>
              <th className="px-4 py-2 font-medium">{t('users.status')}</th>
              <th className="px-4 py-2"><span className="sr-only">{t('actions')}</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {users.map((user) => (
              <tr key={user.id}>
                <td className="px-4 py-2">
                  <p className="font-semibold text-slate-900">{user.name}</p>
                  <p className="text-xs text-slate-500">{user.email}</p>
                </td>
                <td className="px-4 py-2 text-slate-600">
                  {user.memberships.length === 0
                    ? '—'
                    : user.memberships.map((membership) => `${membership.workspace} (${tRoles(membership.role)})`).join(', ')}
                </td>
                <td className="px-4 py-2 text-slate-600">
                  {user.lastSignIn ? format.dateTime(new Date(user.lastSignIn), { dateStyle: 'medium', timeStyle: 'short' }) : t('users.never')}
                </td>
                <td className="px-4 py-2">
                  {user.isRoot ? (
                    <span className="badge bg-amber-100 text-amber-800">{t('users.root')}</span>
                  ) : user.disabled ? (
                    <span className="badge bg-red-100 text-red-700">{t('users.disabled')}</span>
                  ) : (
                    <span className="badge bg-emerald-100 text-emerald-700">{t('users.active')}</span>
                  )}
                </td>
                <td className="px-4 py-2">
                  {!user.isRoot && (
                    <div className="flex justify-end gap-1">
                      <button
                        type="button"
                        className="btn-ghost h-9 whitespace-nowrap"
                        disabled={busy === user.id}
                        onClick={async () => {
                          const ok = await confirm({
                            title: t('users.signOutQuestion', { name: user.name }),
                            body: t('users.signOutBody'),
                            confirmLabel: t('users.signOut'),
                          });
                          if (ok) await run(user.id, `/api/root/users/${user.id}/sign-out`, 'POST', undefined, t('users.signedOut', { name: user.name }));
                        }}
                      >
                        <Icon name="signOut" size={14} /> {t('users.signOut')}
                      </button>
                      <button
                        type="button"
                        className="btn-ghost h-9 whitespace-nowrap"
                        disabled={busy === user.id}
                        onClick={async () => {
                          const ok = await confirm({
                            title: t('users.resetQuestion', { name: user.name }),
                            body: t('users.resetBody'),
                            confirmLabel: t('users.reset'),
                          });
                          if (ok) await run(user.id, `/api/root/users/${user.id}/reset-two-step`, 'POST', undefined, t('users.resetDone', { name: user.name }));
                        }}
                      >
                        <Icon name="key" size={14} /> {t('users.reset')}
                      </button>
                      {user.disabled ? (
                        <button
                          type="button"
                          className="btn-secondary h-9 whitespace-nowrap"
                          disabled={busy === user.id}
                          onClick={() => void run(user.id, `/api/root/users/${user.id}`, 'PATCH', { disabled: false }, t('users.enabled', { name: user.name }))}
                        >
                          {t('users.enable')}
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="btn-ghost h-9 whitespace-nowrap text-red-700"
                          disabled={busy === user.id}
                          onClick={async () => {
                            const ok = await confirm({
                              title: t('users.disableQuestion', { name: user.name }),
                              body: t('users.disableBody'),
                              confirmLabel: t('users.disable'),
                              danger: true,
                            });
                            if (ok) await run(user.id, `/api/root/users/${user.id}`, 'PATCH', { disabled: true }, t('users.disabledDone', { name: user.name }));
                          }}
                        >
                          {t('users.disable')}
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn-ghost h-9 whitespace-nowrap text-red-700"
                        disabled={busy === user.id}
                        onClick={async () => {
                          const ok = await confirm({
                            title: t('users.deleteQuestion', { name: user.name }),
                            body: t('users.deleteBody'),
                            confirmLabel: t('users.delete'),
                            danger: true,
                          });
                          if (ok) await run(user.id, `/api/root/users/${user.id}`, 'DELETE', undefined, t('users.deleted', { name: user.name }));
                        }}
                      >
                        <Icon name="trash" size={14} /> {t('users.delete')}
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function RegistrationSwitch({ open }: { open: boolean }) {
  const t = useTranslations('root');
  const confirm = useConfirm();
  const { busy, run, messages } = useAction();

  return (
    <div className="space-y-3">
      {messages}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold text-slate-900">{open ? t('registration.openNow') : t('registration.closedNow')}</p>
          <p className="text-sm text-slate-600">{t('registration.hint')}</p>
        </div>
        <button
          type="button"
          className={open ? 'btn-secondary' : 'btn-primary'}
          disabled={busy !== null}
          onClick={async () => {
            if (!open) {
              const ok = await confirm({ title: t('registration.openQuestion'), body: t('registration.openBody'), confirmLabel: t('registration.open') });
              if (!ok) return;
            }
            await run('switch', '/api/root/config', 'POST', { values: { 'auth.openRegistration': !open } });
          }}
        >
          {open ? t('registration.close') : t('registration.open')}
        </button>
      </div>
    </div>
  );
}

export interface RootInvitation {
  id: string;
  email: string;
  role: string;
  workspace: string;
  invitedBy: string;
  expiresAt: string;
}

export function InvitationsTable({ invitations }: { invitations: RootInvitation[] }) {
  const t = useTranslations('root');
  const tRoles = useTranslations('team.roles');
  const format = useFormatter();
  const confirm = useConfirm();
  const { busy, run, messages } = useAction();

  if (invitations.length === 0) return <p className="text-sm text-slate-600">{t('registration.noInvitations')}</p>;

  return (
    <div className="space-y-3">
      {messages}
      <div className="scroll-x">
        <table className="w-full min-w-[36rem] text-start text-sm">
          <thead className="text-xs text-slate-500">
            <tr>
              <th className="py-2 pe-3 font-medium">{t('registration.email')}</th>
              <th className="py-2 pe-3 font-medium">{t('registration.workspace')}</th>
              <th className="py-2 pe-3 font-medium">{t('registration.invitedBy')}</th>
              <th className="py-2 pe-3 font-medium">{t('registration.expires')}</th>
              <th className="py-2"><span className="sr-only">{t('actions')}</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {invitations.map((invitation) => (
              <tr key={invitation.id}>
                <td className="py-2 pe-3">
                  <span className="font-medium text-slate-900">{invitation.email}</span>
                  <span className="ms-1 text-xs text-slate-500">· {tRoles(invitation.role)}</span>
                </td>
                <td className="py-2 pe-3 text-slate-600">{invitation.workspace}</td>
                <td className="py-2 pe-3 text-slate-600">{invitation.invitedBy}</td>
                <td className="py-2 pe-3 text-slate-600">{format.dateTime(new Date(invitation.expiresAt), { dateStyle: 'medium' })}</td>
                <td className="py-2 text-end">
                  <button
                    type="button"
                    className="btn-ghost h-9 text-red-700"
                    disabled={busy === invitation.id}
                    onClick={async () => {
                      const ok = await confirm({
                        title: t('registration.revokeQuestion', { email: invitation.email }),
                        body: t('registration.revokeBody'),
                        confirmLabel: t('registration.revoke'),
                        danger: true,
                      });
                      if (ok) await run(invitation.id, `/api/root/invitations/${invitation.id}`, 'DELETE');
                    }}
                  >
                    {t('registration.revoke')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function TransferRoot({ users }: { users: Array<{ id: string; label: string }> }) {
  const t = useTranslations('root');
  const router = useRouter();
  const confirm = useConfirm();
  const { busy, run, messages } = useAction();
  const [userId, setUserId] = useState('');
  const [password, setPassword] = useState('');

  if (users.length === 0) return <p className="text-sm text-slate-600">{t('danger.nobody')}</p>;

  return (
    <form
      className="space-y-3"
      onSubmit={async (event) => {
        event.preventDefault();
        const target = users.find((user) => user.id === userId);
        if (!target) return;
        const ok = await confirm({
          title: t('danger.question', { name: target.label }),
          body: t('danger.body'),
          confirmLabel: t('danger.confirm'),
          danger: true,
        });
        if (!ok) return;
        if (await run('transfer', '/api/root/transfer', 'POST', { userId, password })) router.push('/dashboard');
      }}
    >
      {messages}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-900">{t('danger.to')}</span>
          <select className="input" value={userId} required onChange={(event) => setUserId(event.target.value)}>
            <option value="">{t('danger.pick')}</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-900">{t('danger.password')}</span>
          <input
            type="password"
            className="input"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
      </div>
      <button type="submit" className="btn-primary bg-red-600 hover:bg-red-700" disabled={busy !== null || !userId || !password}>
        {busy ? t('working') : t('danger.submit')}
      </button>
    </form>
  );
}

export interface RootClientInvitation {
  id: string;
  email: string;
  workspaceName: string | null;
  expiresAt: string;
}

/**
 * Invite a client to create an account with a workspace of their own. The
 * link is shown too, for when email is not set up or lands in spam.
 */
export function InviteClient({ invitations }: { invitations: RootClientInvitation[] }) {
  const t = useTranslations('root.clients');
  const format = useFormatter();
  const confirm = useConfirm();
  const router = useRouter();
  const { busy, run, messages } = useAction();
  const [email, setEmail] = useState('');
  const [workspaceName, setWorkspaceName] = useState('');
  const [link, setLink] = useState<{ url: string; emailed: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  return (
    <div className="space-y-4">
      <form
        className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end"
        onSubmit={async (event) => {
          event.preventDefault();
          setSending(true);
          setError(null);
          setLink(null);
          try {
            const response = await fetch('/api/root/client-invitations', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ email, workspaceName: workspaceName || undefined }),
            });
            const data = (await response.json().catch(() => ({}))) as { url?: string; emailed?: boolean; error?: string };
            if (!response.ok) setError(data.error ?? `HTTP ${response.status}`);
            else {
              setLink({ url: data.url!, emailed: Boolean(data.emailed) });
              setEmail('');
              setWorkspaceName('');
              router.refresh();
            }
          } catch {
            setError(t('networkError'));
          }
          setSending(false);
        }}
      >
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-900">{t('email')}</span>
          <input type="email" className="input" required autoComplete="off" spellCheck={false} value={email} onChange={(event) => setEmail(event.target.value)} />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-900">{t('workspace')}</span>
          <input className="input" maxLength={100} autoComplete="off" placeholder={t('workspacePlaceholder')} value={workspaceName} onChange={(event) => setWorkspaceName(event.target.value)} />
        </label>
        <button type="submit" className="btn-primary" disabled={sending || !email}>
          <Icon name="mail" size={14} /> {sending ? t('sending') : t('invite')}
        </button>
      </form>
      {error && (
        <p role="alert" className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <Icon name="error" size={14} /> {error}
        </p>
      )}
      {link && (
        <div role="status" className="space-y-1 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          <p>{link.emailed ? t('sent') : t('notEmailed')}</p>
          <code className="block break-all rounded bg-white px-2 py-1 text-xs text-slate-900" translate="no">{link.url}</code>
        </div>
      )}
      {messages}
      {invitations.length > 0 && (
        <ul className="divide-y divide-slate-100 text-sm">
          {invitations.map((invitation) => (
            <li key={invitation.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="min-w-0">
                <span className="font-medium text-slate-900">{invitation.email}</span>
                {invitation.workspaceName && <span className="text-slate-500"> · {invitation.workspaceName}</span>}
                <span className="block text-xs text-slate-500">
                  {t('expires', { date: format.dateTime(new Date(invitation.expiresAt), { dateStyle: 'medium' }) })}
                </span>
              </span>
              <button
                type="button"
                className="btn-ghost h-9 text-red-700"
                disabled={busy === invitation.id}
                onClick={async () => {
                  const ok = await confirm({ title: t('revokeQuestion', { email: invitation.email }), body: t('revokeBody'), confirmLabel: t('revoke'), danger: true });
                  if (ok) await run(invitation.id, `/api/root/client-invitations/${invitation.id}`, 'DELETE');
                }}
              >
                {t('revoke')}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const ROLE_OPTIONS = ['owner', 'admin', 'editor', 'contributor', 'viewer', 'client'] as const;

export interface RootWorkspaceDetail {
  id: string;
  name: string;
  suspended: boolean;
  developerFeatures: boolean;
  disabledModules: string[];
  members: Array<{
    id: string;
    name: string;
    email: string;
    disabled: boolean;
    role: string;
    disabledModules: string[];
  }>;
}

/** Module switches as a row of checkboxes: checked means the module is on. */
function ModuleSwitches({
  id,
  moduleKeys,
  off,
  locked = [],
  disabled,
  onChange,
}: {
  id: string;
  moduleKeys: readonly string[];
  off: string[];
  /** Off for the whole workspace: shown off, not changeable here. */
  locked?: string[];
  disabled: boolean;
  onChange: (off: string[]) => void;
}) {
  const tNav = useTranslations('nav.module');
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1">
      {moduleKeys.map((key) => {
        const isLocked = locked.includes(key);
        return (
          <label key={key} className={`inline-flex h-9 items-center gap-2 text-sm ${isLocked ? 'text-slate-400' : 'text-slate-700'}`}>
            <input
              id={`${id}-${key}`}
              type="checkbox"
              className="h-4 w-4 rounded border-slate-300 text-brand-600"
              checked={!isLocked && !off.includes(key)}
              disabled={disabled || isLocked}
              onChange={(event) =>
                onChange(event.target.checked ? off.filter((entry) => entry !== key) : [...off, key])
              }
            />
            {tNav(key)}
          </label>
        );
      })}
    </div>
  );
}

export function WorkspaceDetail({ workspace, moduleKeys }: { workspace: RootWorkspaceDetail; moduleKeys: readonly string[] }) {
  const t = useTranslations('root');
  const tRoles = useTranslations('team.roles');
  const confirm = useConfirm();
  const router = useRouter();
  const { busy, run, messages } = useAction();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<string>('editor');

  const base = `/api/root/workspaces/${workspace.id}`;

  return (
    <div className="space-y-6">
      {messages}

      <section className="card space-y-3 p-4 sm:p-5">
        <h2 className="text-base font-semibold text-slate-900">{t('workspace.access')}</h2>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn-primary h-10"
            disabled={busy === 'visit'}
            onClick={async () => {
              if (await run('visit', `${base}/visit`, 'POST')) router.push('/dashboard');
            }}
          >
            <Icon name="shield" size={16} /> {t('workspace.open')}
          </button>
          <p className="text-sm text-slate-600">{t('workspace.openHelp')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
          {workspace.suspended ? (
            <>
              <span className="badge bg-red-100 text-red-700">{t('workspace.suspendedBadge')}</span>
              <button
                type="button"
                className="btn-secondary h-10"
                disabled={busy === 'suspend'}
                onClick={() => void run('suspend', base, 'PATCH', { suspended: false }, t('workspace.resumed'))}
              >
                {t('workspace.resume')}
              </button>
            </>
          ) : (
            <button
              type="button"
              className="btn-ghost h-10 text-red-700"
              disabled={busy === 'suspend'}
              onClick={async () => {
                const ok = await confirm({
                  title: t('workspace.suspendQuestion', { name: workspace.name }),
                  body: t('workspace.suspendBody'),
                  confirmLabel: t('workspace.suspend'),
                  danger: true,
                });
                if (ok) await run('suspend', base, 'PATCH', { suspended: true }, t('workspace.suspendedDone'));
              }}
            >
              {t('workspace.suspend')}
            </button>
          )}
          <button
            type="button"
            className="btn-ghost h-10 text-red-700"
            disabled={busy === 'delete'}
            onClick={async () => {
              const ok = await confirm({
                title: t('workspace.deleteQuestion', { name: workspace.name }),
                body: t('workspace.deleteBody'),
                confirmLabel: t('workspace.delete'),
                danger: true,
              });
              if (ok && (await run('delete', base, 'DELETE'))) router.push('/root/workspaces');
            }}
          >
            <Icon name="trash" size={16} /> {t('workspace.delete')}
          </button>
        </div>
      </section>

      <section className="card space-y-2 p-4 sm:p-5">
        <h2 className="text-base font-semibold text-slate-900">{t('workspace.modules')}</h2>
        <p className="text-sm text-slate-600">{t('workspace.modulesHelp')}</p>
        <ModuleSwitches
          id="workspace-modules"
          moduleKeys={moduleKeys}
          off={workspace.disabledModules}
          disabled={busy === 'modules'}
          onChange={(off) => void run('modules', base, 'PATCH', { disabledModules: off }, t('workspace.modulesSaved'))}
        />
        <label className="flex items-start gap-2 border-t border-slate-100 pt-3 text-sm text-slate-700">
          <input
            id="workspace-developer"
            type="checkbox"
            className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600"
            checked={workspace.developerFeatures}
            disabled={busy === 'developer'}
            onChange={(event) =>
              void run('developer', base, 'PATCH', { developerFeatures: event.target.checked }, t('workspace.developerSaved'))
            }
          />
          <span>
            <span className="font-medium">{t('workspace.developer')}</span>
            <span className="block text-xs text-slate-500">{t('workspace.developerHelp')}</span>
          </span>
        </label>
      </section>

      <section className="card space-y-3 p-0">
        <div className="px-4 pt-4 sm:px-5">
          <h2 className="text-base font-semibold text-slate-900">{t('workspace.membersTitle', { count: workspace.members.length })}</h2>
          <p className="text-sm text-slate-600">{t('workspace.membersHelp')}</p>
        </div>
        <div className="scroll-x">
          <table className="w-full min-w-[44rem] text-start text-sm">
            <thead className="border-y border-slate-200 text-xs text-slate-500">
              <tr>
                <th className="px-4 py-2 font-medium">{t('users.person')}</th>
                <th className="px-4 py-2 font-medium">{t('workspace.role')}</th>
                <th className="px-4 py-2 font-medium">{t('workspace.memberModules')}</th>
                <th className="px-4 py-2"><span className="sr-only">{t('actions')}</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {workspace.members.map((member) => (
                <tr key={member.id}>
                  <td className="px-4 py-2">
                    <p className="font-semibold text-slate-900">{member.name}</p>
                    <p className="text-xs text-slate-500">
                      {member.email}
                      {member.disabled && <span className="badge ms-2 bg-red-100 text-red-700">{t('users.disabled')}</span>}
                    </p>
                  </td>
                  <td className="px-4 py-2">
                    <label className="sr-only" htmlFor={`role-${member.id}`}>{t('workspace.role')}</label>
                    <select
                      id={`role-${member.id}`}
                      className="input h-9 w-auto"
                      value={member.role}
                      disabled={busy === member.id}
                      onChange={(event) =>
                        void run(member.id, `/api/root/members/${member.id}`, 'PATCH', { role: event.target.value }, t('workspace.roleSaved', { name: member.name }))
                      }
                    >
                      {ROLE_OPTIONS.map((option) => (
                        <option key={option} value={option}>{tRoles(option)}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-2">
                    <ModuleSwitches
                      id={`modules-${member.id}`}
                      moduleKeys={moduleKeys}
                      off={member.disabledModules}
                      locked={workspace.disabledModules}
                      disabled={busy === member.id}
                      onChange={(off) =>
                        void run(member.id, `/api/root/members/${member.id}`, 'PATCH', { disabledModules: off }, t('workspace.modulesSaved'))
                      }
                    />
                  </td>
                  <td className="px-4 py-2 text-end">
                    <button
                      type="button"
                      className="btn-ghost h-9 whitespace-nowrap text-red-700"
                      disabled={busy === member.id}
                      onClick={async () => {
                        const ok = await confirm({
                          title: t('workspace.removeQuestion', { name: member.name, workspace: workspace.name }),
                          body: t('workspace.removeBody'),
                          confirmLabel: t('workspace.remove'),
                          danger: true,
                        });
                        if (ok) await run(member.id, `/api/root/members/${member.id}`, 'DELETE', undefined, t('workspace.removed', { name: member.name }));
                      }}
                    >
                      {t('workspace.remove')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <form
          className="flex flex-wrap items-end gap-2 border-t border-slate-100 px-4 pb-4 pt-3 sm:px-5"
          onSubmit={async (event) => {
            event.preventDefault();
            if (await run('add', `${base}/members`, 'POST', { email, role }, t('workspace.added'))) setEmail('');
          }}
        >
          <label className="min-w-[14rem] flex-1">
            <span className="label">{t('workspace.addEmail')}</span>
            <input className="input" type="email" value={email} autoComplete="off" required onChange={(event) => setEmail(event.target.value)} />
          </label>
          <label>
            <span className="label">{t('workspace.role')}</span>
            <select className="input h-10 w-auto" value={role} onChange={(event) => setRole(event.target.value)}>
              {ROLE_OPTIONS.map((option) => (
                <option key={option} value={option}>{tRoles(option)}</option>
              ))}
            </select>
          </label>
          <button type="submit" className="btn-primary h-10" disabled={busy === 'add' || !email.trim()}>
            {t('workspace.add')}
          </button>
          <p className="w-full text-xs text-slate-500">{t('workspace.addHelp')}</p>
        </form>
      </section>
    </div>
  );
}
