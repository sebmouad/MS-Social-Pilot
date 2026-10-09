'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';

import { Icon, type IconName } from './Icon';
import { blockerMessage } from './blockerMessage';

export interface TargetView {
  id: string;
  name: string;
  type: string;
  pictureUrl: string | null;
  enabled: boolean;
  canPublish: boolean;
  publishBlocker: string | null;
  publishBlockerCode: string | null;
  /** Whether a Page token of its own is stored, rather than borrowing the user's. */
  hasOwnToken: boolean;
  followers: number | null;
  lastSyncedLabel: string | null;
}

export interface ConnectionView {
  id: string;
  name: string;
  pictureUrl: string | null;
  providerUserId: string;
  scopes: string[];
  tokenExpiresAt: string | null;
  /** Days until expiry, or null when the token does not expire. */
  daysLeft: number | null;
  invalidReason: string | null;
  lastSyncedLabel: string | null;
  targets: TargetView[];
}

export interface LinkedAccountView {
  id: string;
  label: string;
  detail: string | null;
  enabled: boolean;
  lastSyncedLabel: string | null;
}

/**
 * Everything this workspace is connected to, and the state of each connection.
 *
 * The token is the thing that actually breaks, so it leads: a 60-day user token
 * dies quietly and every scheduled post starts failing with nobody watching.
 * Expiry is shown as days remaining rather than a date, because "expires 14 Sep"
 * requires the reader to do arithmetic before they know whether to care.
 */
export function ConnectionsClient({
  connections,
  instagram,
  ads,
  instagramEnabled,
  adsEnabled,
  canManage,
}: {
  connections: ConnectionView[];
  instagram: LinkedAccountView[];
  ads: LinkedAccountView[];
  instagramEnabled: boolean;
  adsEnabled: boolean;
  canManage: boolean;
}) {
  const t = useTranslations('connections');
  const locale = useLocale();
  const tCommon = useTranslations('common');
  const router = useRouter();

  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function call(
    id: string,
    path: string,
    method: string,
    body?: unknown,
  ): Promise<Record<string, unknown> | null> {
    setBusy(id);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(path, {
        method,
        ...(body === undefined
          ? {}
          : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
      });
      const payload = (await response.json().catch(() => ({}))) as Record<string, unknown> & {
        error?: string;
      };
      if (!response.ok) {
        setError(payload.error ?? tCommon('genericError'));
        return null;
      }
      router.refresh();
      return payload;
    } catch {
      // Unhandled, a dropped connection would surface as nothing at all — the
      // button re-enables and the reader assumes it worked.
      setError(t('networkError'));
      return null;
    } finally {
      setBusy(null);
    }
  }

  /**
   * Both of these leave Facebook holding posts that will publish anyway, and
   * the service layer counts them. Saying nothing here would put the silence
   * back one layer: somebody turns a Page off, a post appears on it the next
   * morning, and nothing they saw suggested that could happen.
   */
  async function disconnectAccount(accountId: string) {
    const body = (await call(accountId, `/api/accounts/${accountId}`, 'DELETE')) as {
      stillScheduledOnFacebook?: number;
    } | null;
    const stranded = body?.stillScheduledOnFacebook ?? 0;
    if (stranded > 0) setError(t('stillScheduledGone', { count: stranded }));
  }

  async function toggleTarget(id: string, enabled: boolean) {
    const body = (await call(id, `/api/targets/${id}`, 'PATCH', { enabled })) as {
      stillScheduledOnFacebook?: number;
    } | null;
    const waiting = body?.stillScheduledOnFacebook ?? 0;
    if (waiting > 0) setNotice(t('stillScheduledOff', { count: waiting }));
  }

  async function sync(accountId: string) {
    const body = (await call(accountId, `/api/accounts/${accountId}/sync`, 'POST')) as {
      pages?: number;
      groups?: number;
      warnings?: string[];
    } | null;
    if (body) {
      setNotice(t('syncedResult', { pages: body.pages ?? 0, groups: body.groups ?? 0 }));
      if (body.warnings?.length) setError(String(body.warnings[0]));
    }
  }

  async function check(accountId: string) {
    const body = (await call(accountId, `/api/accounts/${accountId}`, 'GET')) as {
      health?: { valid: boolean; message: string | null; expiresAt: string | null };
    } | null;
    if (body?.health) {
      setNotice(
        body.health.message ??
          (body.health.expiresAt
            ? t('tokenValidUntil', {
                when: new Date(body.health.expiresAt).toLocaleDateString(locale),
              })
            : t('tokenValid')),
      );
    }
  }

  /** Expiry as a state, not a date: the reader should not have to subtract. */
  function tokenBadge(connection: ConnectionView) {
    if (connection.invalidReason) {
      return { tone: 'bg-red-100 text-red-700', icon: 'error' as IconName, text: t('tokenDead') };
    }
    if (connection.daysLeft === null) {
      return { tone: 'bg-slate-100 text-slate-600', icon: 'key' as IconName, text: t('tokenNoExpiry') };
    }
    if (connection.daysLeft <= 7) {
      return {
        tone: 'bg-amber-100 text-amber-800',
        icon: 'warning' as IconName,
        text: t('tokenDays', { count: connection.daysLeft }),
      };
    }
    return {
      tone: 'bg-emerald-100 text-emerald-800',
      icon: 'check' as IconName,
      text: t('tokenDays', { count: connection.daysLeft }),
    };
  }

  return (
    <div className="space-y-6">
      {error && (
        <p role="alert" className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <Icon name="error" /> {error}
        </p>
      )}
      {notice && (
        <p role="status" className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          <Icon name="check" /> {notice}
        </p>
      )}

      {connections.map((connection) => {
        const badge = tokenBadge(connection);
        const pages = connection.targets.filter((target) => target.type === 'page');
        const groups = connection.targets.filter((target) => target.type === 'group');
        const instagramTargets = connection.targets.filter(
          (target) => target.type === 'instagram',
        );

        return (
          <section key={connection.id} className="card p-4 sm:p-5">
            <header className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                {connection.pictureUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={connection.pictureUrl}
                    alt=""
                    className="h-10 w-10 shrink-0 rounded-full object-cover"
                  />
                ) : (
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500">
                    <Icon name="accounts" />
                  </span>
                )}

                <div className="min-w-0">
                  <p className="truncate font-medium text-slate-900">{connection.name}</p>
                  <p className="text-xs text-slate-500">
                    {t('facebookUser', { id: connection.providerUserId })}
                    {connection.lastSyncedLabel && ` · ${t('synced', { when: connection.lastSyncedLabel })}`}
                  </p>
                </div>
              </div>

              <span className={`badge ${badge.tone}`}>
                <Icon name={badge.icon} size={13} />
                {badge.text}
              </span>
            </header>

            {connection.invalidReason && (
              <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                {connection.invalidReason}
              </p>
            )}

            {/* Scopes are the other half of a broken connection: a token can be
                alive and still be missing the permission a job needs. */}
            <div className="mt-3">
              <p className="text-[13px] font-semibold text-slate-600">
                {t('permissions')}
              </p>
              <ul className="mt-1 flex flex-wrap gap-1">
                {connection.scopes.length === 0 ? (
                  <li className="text-xs text-slate-500">{t('noScopes')}</li>
                ) : (
                  connection.scopes.map((scope) => (
                    <li key={scope} className="badge bg-slate-100 font-mono text-[10px] text-slate-600">
                      {scope}
                    </li>
                  ))
                )}
              </ul>
            </div>

            {canManage && (
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={busy === connection.id}
                  onClick={() => sync(connection.id)}
                >
                  <Icon name="refresh" size={15} /> {t('syncTargets')}
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={busy === connection.id}
                  onClick={() => check(connection.id)}
                >
                  <Icon name="key" size={15} /> {t('checkToken')}
                </button>
                {/* A full navigation, not fetch: the route redirects to Facebook. */}
                <a href="/api/facebook/connect" className="btn-secondary">
                  <Icon name="link" size={15} /> {t('reconnect')}
                </a>
                <button
                  type="button"
                  className="btn-danger"
                  disabled={busy === connection.id}
                  onClick={() => {
                    if (window.confirm(t('disconnectConfirm', { name: connection.name }))) {
                      void disconnectAccount(connection.id);
                    }
                  }}
                >
                  <Icon name="trash" size={15} /> {t('disconnect')}
                </button>
              </div>
            )}

            <TargetList
              title={t('pages')}
              icon="facebook"
              targets={pages}
              empty={t('noPages')}
              canManage={canManage}
              busy={busy}
              onToggle={(id, enabled) => toggleTarget(id, enabled)}
            />

            <TargetList
              title={t('groups')}
              icon="group"
              targets={groups}
              empty={t('noGroups')}
              canManage={canManage}
              busy={busy}
              onToggle={(id, enabled) => toggleTarget(id, enabled)}
            />

            {/* Only once there is one: a workspace with no linked Instagram
                account should not be shown an empty section explaining a
                feature it is not using. */}
            {instagramTargets.length > 0 && (
              <TargetList
                title={t('instagramDestinations')}
                icon="instagram"
                targets={instagramTargets}
                empty={t('noPages')}
                canManage={canManage}
                busy={busy}
                onToggle={(id, enabled) => toggleTarget(id, enabled)}
              />
            )}
          </section>
        );
      })}

      <LinkedAccounts
        title={t('instagramTitle')}
        description={t('instagramHint')}
        icon="instagram"
        accounts={instagram}
        enabled={instagramEnabled}
        disabledNote={t('featureOff')}
        discoverPath="/api/instagram"
        togglePath="/api/connections/instagram"
        canManage={canManage}
        busy={busy}
        call={call}
      />

      <LinkedAccounts
        title={t('adsTitle')}
        description={t('adsHint')}
        icon="megaphone"
        accounts={ads}
        enabled={adsEnabled}
        disabledNote={t('featureOff')}
        discoverPath="/api/ads"
        togglePath="/api/connections/ads"
        canManage={canManage}
        busy={busy}
        call={call}
      />
    </div>
  );
}

function TargetList({
  title,
  icon,
  targets,
  empty,
  canManage,
  busy,
  onToggle,
}: {
  title: string;
  icon: IconName;
  targets: TargetView[];
  empty: string;
  canManage: boolean;
  busy: string | null;
  onToggle: (id: string, enabled: boolean) => void;
}) {
  const t = useTranslations('connections');

  return (
    <div className="mt-5">
      <h3 className="flex items-center gap-1.5 text-[13px] font-semibold text-slate-600">
        <Icon name={icon} size={14} /> {title} · {targets.length}
      </h3>

      {targets.length === 0 ? (
        <p className="mt-2 text-sm text-slate-500">{empty}</p>
      ) : (
        <ul className="mt-2 divide-y divide-slate-100">
          {targets.map((target) => {
            const blocked = blockerMessage(
              target.publishBlockerCode,
              target.publishBlocker,
              (key) => t(key as Parameters<typeof t>[0]),
              (key) => t.has(key as Parameters<typeof t>[0]),
            );

            return (
            <li key={target.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
              <div className="flex min-w-0 items-center gap-2.5">
                {target.pictureUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={target.pictureUrl} alt="" className="h-8 w-8 rounded-lg object-cover" />
                ) : (
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-slate-400">
                    <Icon name={icon} size={15} />
                  </span>
                )}

                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-900">{target.name}</p>
                  <p className="text-xs text-slate-500">
                    {/* Which credential publishes this: a Page with its own
                        token keeps working when the user token is re-scoped. */}
                    {target.hasOwnToken ? t('ownToken') : t('userToken')}
                    {target.followers !== null && ` · ${t('followers', { count: target.followers })}`}
                  </p>
                  {!target.canPublish && blocked && (
                    <p className="mt-0.5 flex items-center gap-1 text-xs text-amber-700">
                      <Icon name="warning" size={12} /> {blocked}
                    </p>
                  )}
                </div>
              </div>

              <label className="flex shrink-0 items-center gap-2 text-xs text-slate-600">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-slate-300"
                  checked={target.enabled}
                  aria-label={t('toggleDestination', { name: target.name })}
                  disabled={!canManage || busy === target.id}
                  onChange={(event) => onToggle(target.id, event.target.checked)}
                />
                {target.enabled ? t('active') : t('paused')}
              </label>
            </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function LinkedAccounts({
  title,
  description,
  icon,
  accounts,
  enabled,
  disabledNote,
  discoverPath,
  togglePath,
  canManage,
  busy,
  call,
}: {
  title: string;
  description: string;
  icon: IconName;
  accounts: LinkedAccountView[];
  enabled: boolean;
  disabledNote: string;
  discoverPath: string;
  togglePath: string;
  canManage: boolean;
  busy: string | null;
  call: (id: string, path: string, method: string, body?: unknown) => Promise<unknown>;
}) {
  const t = useTranslations('connections');

  return (
    <section className="card p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <Icon name={icon} className="text-slate-400" /> {title}
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">{description}</p>
        </div>

        {canManage && enabled && (
          <button
            type="button"
            className="btn-secondary"
            disabled={busy === discoverPath}
            onClick={() => call(discoverPath, discoverPath, 'POST', { action: 'discover' })}
          >
            <Icon name="search" size={15} /> {t('discover')}
          </button>
        )}
      </div>

      {!enabled ? (
        <p className="mt-3 flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
          <Icon name="warning" size={15} /> {disabledNote}
        </p>
      ) : accounts.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">{t('noneFound')}</p>
      ) : (
        <ul className="mt-3 divide-y divide-slate-100">
          {accounts.map((account) => (
            <li key={account.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-slate-900">{account.label}</p>
                <p className="text-xs text-slate-500">
                  {account.detail}
                  {account.lastSyncedLabel && ` · ${t('synced', { when: account.lastSyncedLabel })}`}
                </p>
              </div>

              <label className="flex shrink-0 items-center gap-2 text-xs text-slate-600">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-slate-300"
                  checked={account.enabled}
                  aria-label={t('toggleAccount', { name: account.label })}
                  disabled={!canManage || busy === account.id}
                  onChange={(event) =>
                    call(account.id, `${togglePath}/${account.id}`, 'PATCH', {
                      enabled: event.target.checked,
                    })
                  }
                />
                {account.enabled ? t('active') : t('paused')}
              </label>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
