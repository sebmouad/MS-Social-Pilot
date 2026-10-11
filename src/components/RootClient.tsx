'use client';

import { useState } from 'react';
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
}

export function WorkspacesTable({ workspaces }: { workspaces: RootWorkspace[] }) {
  const t = useTranslations('root');
  const format = useFormatter();
  const { busy, run, messages } = useAction();
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState('');

  return (
    <div className="space-y-3">
      {messages}
      <div className="card scroll-x p-0">
        <table className="w-full min-w-[40rem] text-left text-sm tabular-nums">
          <thead className="border-b border-slate-200 text-xs text-slate-500">
            <tr>
              <th className="px-4 py-2 font-medium">{t('workspaces.name')}</th>
              <th className="px-4 py-2 font-medium">{t('workspaces.owners')}</th>
              <th className="px-4 py-2 text-right font-medium">{t('workspaces.members')}</th>
              <th className="px-4 py-2 text-right font-medium">{t('workspaces.pages')}</th>
              <th className="px-4 py-2 text-right font-medium">{t('workspaces.posts')}</th>
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
                    <span className="font-semibold text-slate-900">{workspace.name}</span>
                  )}
                </td>
                <td className="px-4 py-2 text-slate-600">{workspace.owners.join(', ') || '—'}</td>
                <td className="px-4 py-2 text-right">{format.number(workspace.members)}</td>
                <td className="px-4 py-2 text-right">{format.number(workspace.pages)}</td>
                <td className="px-4 py-2 text-right">{format.number(workspace.posts)}</td>
                <td className="px-4 py-2 text-slate-600">{format.dateTime(new Date(workspace.createdAt), { dateStyle: 'medium' })}</td>
                <td className="px-4 py-2 text-right">
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
        <table className="w-full min-w-[44rem] text-left text-sm">
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
        <table className="w-full min-w-[36rem] text-left text-sm">
          <thead className="text-xs text-slate-500">
            <tr>
              <th className="py-2 pr-3 font-medium">{t('registration.email')}</th>
              <th className="py-2 pr-3 font-medium">{t('registration.workspace')}</th>
              <th className="py-2 pr-3 font-medium">{t('registration.invitedBy')}</th>
              <th className="py-2 pr-3 font-medium">{t('registration.expires')}</th>
              <th className="py-2"><span className="sr-only">{t('actions')}</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {invitations.map((invitation) => (
              <tr key={invitation.id}>
                <td className="py-2 pr-3">
                  <span className="font-medium text-slate-900">{invitation.email}</span>
                  <span className="ml-1 text-xs text-slate-500">· {tRoles(invitation.role)}</span>
                </td>
                <td className="py-2 pr-3 text-slate-600">{invitation.workspace}</td>
                <td className="py-2 pr-3 text-slate-600">{invitation.invitedBy}</td>
                <td className="py-2 pr-3 text-slate-600">{format.dateTime(new Date(invitation.expiresAt), { dateStyle: 'medium' })}</td>
                <td className="py-2 text-right">
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
