'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export interface AccountView {
  id: string;
  name: string;
  pictureUrl: string | null;
  tokenExpiresAt: string | null;
  invalidReason: string | null;
  lastSyncedAt: string | null;
  targets: Array<{
    id: string;
    name: string;
    type: string;
    pictureUrl: string | null;
    enabled: boolean;
    canPublish: boolean;
    publishBlocker: string | null;
  }>;
}

export function AccountsClient({ accounts }: { accounts: AccountView[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function call(id: string, path: string, method: string): Promise<unknown | null> {
    setBusy(id);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(path, { method });
      const body = (await response.json().catch(() => ({}))) as Record<string, unknown> & { error?: string };
      if (!response.ok) {
        setError(body.error ?? 'That did not work.');
        return null;
      }
      router.refresh();
      return body;
    } finally {
      setBusy(null);
    }
  }

  async function sync(accountId: string) {
    const body = (await call(accountId, `/api/accounts/${accountId}/sync`, 'POST')) as
      | { pages?: number; groups?: number; warnings?: string[] }
      | null;
    if (body) {
      setNotice(`Synced ${body.pages ?? 0} page(s) and ${body.groups ?? 0} group(s).`);
      if (body.warnings?.length) setError(body.warnings[0] ?? null);
    }
  }

  async function check(accountId: string) {
    const body = (await call(accountId, `/api/accounts/${accountId}`, 'GET')) as
      | { health?: { valid: boolean; message: string | null; expiresAt: string | null } }
      | null;
    if (body?.health) {
      setNotice(
        body.health.message ??
          `Connection is healthy${
            body.health.expiresAt
              ? `; the token expires ${new Date(body.health.expiresAt).toLocaleDateString()}.`
              : ' and does not expire.'
          }`,
      );
    }
  }

  async function disconnect(accountId: string, name: string) {
    if (
      !window.confirm(
        `Disconnect ${name}? Scheduled posts to its pages and groups will be cancelled. Published history is kept.`,
      )
    ) {
      return;
    }
    await call(accountId, `/api/accounts/${accountId}`, 'DELETE');
  }

  async function toggleTarget(targetId: string, enabled: boolean) {
    setBusy(targetId);
    setError(null);
    try {
      const response = await fetch(`/api/targets/${targetId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? 'Could not update that destination.');
        return;
      }
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      {notice && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {notice}
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {error}
        </div>
      )}

      {accounts.map((account) => (
        <section key={account.id} className="card p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              {account.pictureUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={account.pictureUrl} alt="" className="h-10 w-10 rounded-full object-cover" />
              ) : (
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-200 text-sm font-semibold text-slate-600">
                  {account.name.slice(0, 2).toUpperCase()}
                </span>
              )}
              <div>
                <p className="text-sm font-semibold text-slate-900">{account.name}</p>
                <p className="text-xs text-slate-500">
                  {account.targets.length} destination{account.targets.length === 1 ? '' : 's'}
                  {account.lastSyncedAt
                    ? ` · synced ${new Date(account.lastSyncedAt).toLocaleString()}`
                    : ''}
                  {account.tokenExpiresAt
                    ? ` · token expires ${new Date(account.tokenExpiresAt).toLocaleDateString()}`
                    : ''}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn-secondary"
                disabled={busy === account.id}
                onClick={() => check(account.id)}
              >
                Check connection
              </button>
              <button
                type="button"
                className="btn-secondary"
                disabled={busy === account.id}
                onClick={() => sync(account.id)}
              >
                {busy === account.id ? 'Working…' : 'Sync pages'}
              </button>
              <button
                type="button"
                className="btn-danger"
                disabled={busy === account.id}
                onClick={() => disconnect(account.id, account.name)}
              >
                Disconnect
              </button>
            </div>
          </div>

          {account.invalidReason && (
            <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {account.invalidReason} Reconnect this account to resume scheduled posts.
            </p>
          )}

          <ul className="mt-4 divide-y divide-slate-100">
            {account.targets.map((target) => (
              <li key={target.id} className="flex items-center gap-3 py-2.5">
                {target.pictureUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={target.pictureUrl} alt="" className="h-8 w-8 rounded-full object-cover" />
                ) : (
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-600">
                    {target.name.slice(0, 2).toUpperCase()}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-900">{target.name}</p>
                  <p className="truncate text-xs text-slate-500">
                    {target.type === 'group' ? 'Group' : 'Page'}
                    {target.publishBlocker ? ` · ${target.publishBlocker}` : ''}
                  </p>
                </div>
                <label className="flex items-center gap-2 text-xs text-slate-600">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-slate-300 text-brand-500 focus:ring-brand-500"
                    checked={target.enabled}
                    disabled={busy === target.id || (!target.canPublish && !target.enabled)}
                    onChange={(event) => toggleTarget(target.id, event.target.checked)}
                  />
                  Available
                </label>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
