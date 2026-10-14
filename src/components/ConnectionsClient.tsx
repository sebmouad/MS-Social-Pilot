'use client';

import { FeedAvatar } from './FeedPost';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';

import { Icon, type IconName } from './Icon';
import { blockerMessage } from './blockerMessage';
import { Dialog } from './Dialog';

export interface TargetView {
  id: string;
  name: string;
  type: string;
  pictureUrl: string | null;
  enabled: boolean;
  canPublish: boolean;
  publishBlockerCode: string | null;
  followers: number | null;
  lastSyncedLabel: string | null;
}

export interface ConnectionView {
  id: string;
  name: string;
  pictureUrl: string | null;
  /** Plain status only: technical details (tokens, permissions, raw errors) live in /root/connections. */
  needsReconnect: boolean;
  lastSyncedLabel: string | null;
  targets: TargetView[];
}

export interface LinkedAccountView {
  id: string;
  label: string;
  detail: string | null;
  enabled: boolean;
  connected: boolean;
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
  orphans = [],
}: {
  connections: ConnectionView[];
  /** Pages left behind by a disconnected account: no longer reachable, only removable. */
  orphans?: TargetView[];
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
  const [disconnecting, setDisconnecting] = useState<ConnectionView | null>(null);
  const [deleteData, setDeleteData] = useState(false);
  const [disconnectingTarget, setDisconnectingTarget] = useState<TargetView | null>(null);
  const [deleteTargetData, setDeleteTargetData] = useState(false);
  const [disconnectingLinked, setDisconnectingLinked] = useState<{ kind: 'instagram' | 'ads'; id: string; label: string } | null>(null);
  const [deleteLinkedData, setDeleteLinkedData] = useState(false);
  const [targetSelection, setTargetSelection] = useState<Record<string, boolean>>({});

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
    const body = (await call(accountId, `/api/accounts/${accountId}`, 'DELETE', { deleteData })) as {
      stillScheduledOnFacebook?: number;
    } | null;
    if (body) setDisconnecting(null);
    const stranded = body?.stillScheduledOnFacebook ?? 0;
    if (stranded > 0) setError(t('stillScheduledGone', { count: stranded }));
  }

  async function toggleTarget(id: string, enabled: boolean) {
    const body = (await call(id, `/api/targets/${id}`, 'PATCH', { enabled })) as {
      stillScheduledOnFacebook?: number;
    } | null;
    if (body) setTargetSelection((current) => ({ ...current, [id]: enabled }));
    const waiting = body?.stillScheduledOnFacebook ?? 0;
    if (waiting > 0) setNotice(t('stillScheduledOff', { count: waiting }));
  }

  async function removeTarget(target: TargetView) {
    const body = (await call(target.id, `/api/targets/${target.id}`, 'DELETE', { deleteData: deleteTargetData })) as {
      stillScheduledOnFacebook?: number;
    } | null;
    if (!body) return;
    setDisconnectingTarget(null);
    const stranded = body.stillScheduledOnFacebook ?? 0;
    if (stranded > 0) setError(t('stillScheduledRemoved', { count: stranded }));
    else setNotice(deleteTargetData ? t('targetRemoved', { name: target.name }) : t('targetDisconnected', { name: target.name }));
  }

  function statusBadge(connection: ConnectionView) {
    return connection.needsReconnect
      ? { tone: 'bg-red-100 text-red-700', icon: 'error' as IconName, text: t('tokenDead') }
      : { tone: 'bg-emerald-100 text-emerald-800', icon: 'check' as IconName, text: t('tokenNoExpiry') };
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

      <div id="facebook" className="scroll-mt-20" />
      {connections.map((connection) => {
        const badge = statusBadge(connection);
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
                  <p className="text-xs text-slate-500">{t('connectionReference', { id: connection.id.slice(-8) })}</p>
                  {connection.lastSyncedLabel && (
                    <p className="text-xs text-slate-500">{t('synced', { when: connection.lastSyncedLabel })}</p>
                  )}
                </div>
              </div>

              <span className={`badge ${badge.tone}`}>
                <Icon name={badge.icon} size={13} />
                {badge.text}
              </span>
            </header>

            {connection.needsReconnect && (
              <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{t('needsReconnectHint')}</p>
            )}

            {canManage && (
              <div className="mt-4 flex flex-wrap gap-2">
                {/* A full navigation, not fetch: the route redirects to Facebook. */}
                <a href="/api/facebook/connect" className="btn-secondary">
                  <Icon name="link" size={15} /> {t('reconnect')}
                </a>
                <button
                  type="button"
                  className="btn-danger"
                  disabled={busy === connection.id}
                  onClick={() => { setDeleteData(false); setDisconnecting(connection); }}
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
              selection={targetSelection}
              onRemove={(target) => { setDeleteTargetData(false); setDisconnectingTarget(target); }}
            />

            {groups.length > 0 && <TargetList
              title={t('groups')}
              icon="group"
              targets={groups}
              empty={t('noGroups')}
              canManage={canManage}
              busy={busy}
              onToggle={(id, enabled) => toggleTarget(id, enabled)}
              selection={targetSelection}
              onRemove={(target) => { setDeleteTargetData(false); setDisconnectingTarget(target); }}
            />}

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
                selection={targetSelection}
              onRemove={(target) => { setDeleteTargetData(false); setDisconnectingTarget(target); }}
              />
            )}
          </section>
        );
      })}

      {orphans.length > 0 && (
        <section className="card p-4 sm:p-5">
          <h2 className="text-sm font-semibold text-slate-900">{t('orphansTitle')}</h2>
          <p className="mt-0.5 text-xs text-slate-500">{t('orphansHint')}</p>
          <TargetList
            title={t('pages')}
            icon="facebook"
            targets={orphans}
            empty={t('noPages')}
            canManage={canManage}
            busy={busy}
            onToggle={(id, enabled) => toggleTarget(id, enabled)}
            selection={targetSelection}
            onRemove={(target) => { setDeleteTargetData(false); setDisconnectingTarget(target); }}
          />
        </section>
      )}

      {/* Only orphans left: nothing reaches Instagram or ads any more. */}
      {connections.length > 0 && (
        <>
      {(instagramEnabled || instagram.length > 0) && (
      <LinkedAccounts
        kind="instagram"
        anchor="instagram"
        title={t('instagramTitle')}
        description={t('instagramHint')}
        icon="instagram"
        accounts={instagram}
        enabled={instagramEnabled}
        discoverPath="/api/instagram"
        togglePath="/api/connections/instagram"
        canManage={canManage}
        busy={busy}
        call={call}
        onRemove={(account) => { setDeleteLinkedData(false); setDisconnectingLinked({ kind: 'instagram', ...account }); }}
      />
      )}

      {(adsEnabled || ads.length > 0) && (
      <LinkedAccounts
        kind="ads"
        anchor="ads"
        title={t('adsTitle')}
        description={t('adsHint')}
        icon="megaphone"
        accounts={ads}
        enabled={adsEnabled}
        discoverPath="/api/ads"
        togglePath="/api/connections/ads"
        canManage={canManage}
        busy={busy}
        call={call}
        onRemove={(account) => { setDeleteLinkedData(false); setDisconnectingLinked({ kind: 'ads', ...account }); }}
      />
      )}
        </>
      )}
      <Dialog open={disconnecting !== null} title={disconnecting ? t('disconnectConfirm', { name: disconnecting.name }) : t('disconnect')}
        closeLabel={tCommon('close')} onClose={() => setDisconnecting(null)}
        footer={<>
          <button type="button" className="btn-secondary" onClick={() => setDisconnecting(null)}>{tCommon('cancel')}</button>
          <button type="button" className="btn-danger" disabled={busy !== null} onClick={() => disconnecting && void disconnectAccount(disconnecting.id)}>{t('disconnect')}</button>
        </>}>
        <fieldset className="space-y-2 text-sm">
          <legend className="mb-2 font-semibold text-slate-900">{t('disconnectDataChoice')}</legend>
          <label className="flex items-start gap-2 rounded-lg border border-slate-200 p-3"><input type="radio" name="disconnect-data" checked={!deleteData} onChange={() => setDeleteData(false)} />{t('retainRelatedData')}</label>
          <label className="flex items-start gap-2 rounded-lg border border-slate-200 p-3"><input type="radio" name="disconnect-data" checked={deleteData} onChange={() => setDeleteData(true)} />{t('deleteRelatedData')}</label>
        </fieldset>
      </Dialog>
      <Dialog open={disconnectingTarget !== null} title={disconnectingTarget ? t('disconnectTargetConfirm', { name: disconnectingTarget.name }) : t('disconnect')}
        closeLabel={tCommon('close')} onClose={() => setDisconnectingTarget(null)}
        footer={<>
          <button type="button" className="btn-secondary" onClick={() => setDisconnectingTarget(null)}>{tCommon('cancel')}</button>
          <button type="button" className="btn-danger" disabled={busy !== null} onClick={() => disconnectingTarget && void removeTarget(disconnectingTarget)}>{t('disconnect')}</button>
        </>}>
        <fieldset className="space-y-2 text-sm">
          <legend className="mb-2 font-semibold text-slate-900">{t('disconnectDataChoice')}</legend>
          <label className="flex items-start gap-2 rounded-lg border border-slate-200 p-3"><input type="radio" name="target-disconnect-data" checked={!deleteTargetData} onChange={() => setDeleteTargetData(false)} />{t('retainRelatedData')}</label>
          <label className="flex items-start gap-2 rounded-lg border border-slate-200 p-3"><input type="radio" name="target-disconnect-data" checked={deleteTargetData} onChange={() => setDeleteTargetData(true)} />{t('deleteRelatedData')}</label>
        </fieldset>
      </Dialog>
      <Dialog open={disconnectingLinked !== null} title={disconnectingLinked ? t('disconnectTargetConfirm', { name: disconnectingLinked.label }) : t('disconnect')}
        closeLabel={tCommon('close')} onClose={() => setDisconnectingLinked(null)}
        footer={<>
          <button type="button" className="btn-secondary" onClick={() => setDisconnectingLinked(null)}>{tCommon('cancel')}</button>
          <button type="button" className="btn-danger" disabled={busy !== null} onClick={async () => {
            if (!disconnectingLinked) return;
            const result = await call(disconnectingLinked.id, `/api/connections/${disconnectingLinked.kind}/${disconnectingLinked.id}`, 'DELETE', { deleteData: deleteLinkedData });
            if (result) setDisconnectingLinked(null);
          }}>{t('disconnect')}</button>
        </>}>
        <fieldset className="space-y-2 text-sm">
          <legend className="mb-2 font-semibold text-slate-900">{t('disconnectDataChoice')}</legend>
          <label className="flex items-start gap-2 rounded-lg border border-slate-200 p-3"><input type="radio" name="linked-disconnect-data" checked={!deleteLinkedData} onChange={() => setDeleteLinkedData(false)} />{t('retainRelatedData')}</label>
          <label className="flex items-start gap-2 rounded-lg border border-slate-200 p-3"><input type="radio" name="linked-disconnect-data" checked={deleteLinkedData} onChange={() => setDeleteLinkedData(true)} />{t('deleteRelatedData')}</label>
        </fieldset>
      </Dialog>
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
  onRemove,
  selection,
}: {
  title: string;
  icon: IconName;
  targets: TargetView[];
  empty: string;
  canManage: boolean;
  busy: string | null;
  onToggle: (id: string, enabled: boolean) => void;
  onRemove: (target: TargetView) => void;
  selection: Record<string, boolean>;
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
        <div className="scroll-x mt-2">
        <table className="data-table w-full min-w-[640px] text-sm">
          <thead><tr>
            <th scope="col" className="px-3 py-2">{t('columnSource')}</th>
            <th scope="col" className="px-3 py-2">{t('columnAudience')}</th>
            <th scope="col" className="px-3 py-2">{t('columnSync')}</th>
            <th scope="col" className="px-3 py-2">{t('columnStatus')}</th>
            <th scope="col" className="px-3 py-2 text-end">{t('columnActions')}</th>
          </tr></thead>
          <tbody className="divide-y divide-slate-100">
          {targets.map((target) => {
            const blocked = blockerMessage(
              target.publishBlockerCode,
              // Never the stored technical sentence: root sees that in /root/connections.
              null,
              (key) => t(key as Parameters<typeof t>[0]),
              (key) => t.has(key as Parameters<typeof t>[0]),
            ) ?? t('blockedGeneric');

            return (
            <tr key={target.id}>
              <td className="px-3 py-2.5"><div className="flex min-w-0 items-center gap-2.5">
                {/* The Page's own photo, round as Facebook draws it; its
                    initial when Facebook gave none. */}
                {target.type === 'page' || target.pictureUrl ? (
                  <FeedAvatar name={target.name} pictureUrl={target.pictureUrl} />
                ) : (
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-500">
                    <Icon name={icon} size={18} />
                  </span>
                )}

                <div className="min-w-0">
                  <p className="truncate text-[15px] font-semibold text-slate-900">{target.name}</p>
                  {!target.canPublish && blocked && (
                    <p className="mt-0.5 flex items-center gap-1 text-xs text-amber-700">
                      <Icon name="warning" size={12} /> {blocked}
                    </p>
                  )}
                </div>
              </div></td>
              <td className="nums px-3 py-2.5 text-slate-600">{target.followers !== null ? t('followers', { count: target.followers }) : '—'}</td>
              <td className="px-3 py-2.5 text-slate-600">{target.lastSyncedLabel ?? '—'}</td>
              <td className="px-3 py-2.5">
              <label className="flex shrink-0 items-center gap-2 text-xs text-slate-600">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-slate-300"
                  checked={selection[target.id] ?? target.enabled}
                  aria-label={t('toggleDestination', { name: target.name })}
                  disabled={!canManage || busy === target.id}
                  onChange={(event) => onToggle(target.id, event.target.checked)}
                />
                {(selection[target.id] ?? target.enabled) ? t('active') : t('paused')}
              </label>
              </td>
              <td className="px-3 py-2.5 text-end">
              {canManage && (
                <button
                  type="button"
                  className="btn-ghost shrink-0 text-xs text-red-700"
                  disabled={busy === target.id}
                  aria-label={t('disconnectTargetNamed', { name: target.name })}
                  onClick={() => onRemove(target)}
                >
                  <Icon name="trash" size={14} /> {t('disconnect')}
                </button>
              )}
              </td>
            </tr>
            );
          })}
          </tbody>
        </table>
        </div>
      )}
    </div>
  );
}

function LinkedAccounts({
  kind,
  anchor,
  title,
  description,
  icon,
  accounts,
  enabled,
  discoverPath,
  togglePath,
  canManage,
  busy,
  call,
  onRemove,
}: {
  kind: 'instagram' | 'ads';
  /** The id the page's "jump to" chips link to. */
  anchor: string;
  title: string;
  description: string;
  icon: IconName;
  accounts: LinkedAccountView[];
  enabled: boolean;
  discoverPath: string;
  togglePath: string;
  canManage: boolean;
  busy: string | null;
  call: (id: string, path: string, method: string, body?: unknown) => Promise<unknown>;
  onRemove: (account: Pick<LinkedAccountView, 'id' | 'label'>) => void;
}) {
  const t = useTranslations('connections');

  return (
    <section id={anchor} className="card scroll-mt-20 p-4 sm:p-5">
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

      {accounts.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">{t('noneFound')}</p>
      ) : (
        <div className="scroll-x mt-3"><table className="data-table w-full min-w-[520px] text-sm">
          <thead><tr><th scope="col" className="px-3 py-2">{t('columnSource')}</th><th scope="col" className="px-3 py-2">{t('columnSync')}</th><th scope="col" className="px-3 py-2">{t('columnStatus')}</th><th scope="col" className="px-3 py-2 text-end">{t('columnActions')}</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
          {accounts.map((account) => (
            <tr key={account.id}>
              <td className="px-3 py-2.5"><div className="min-w-0">
                <p className="truncate text-sm font-medium text-slate-900">{account.label}</p>
                <p className="text-xs text-slate-500">
                  {account.detail}
                  {` · ${t('accountReference', { id: account.id.slice(-8) })}`}
                </p>
              </div></td>

              <td className="px-3 py-2.5 text-slate-600">{account.lastSyncedLabel ?? '—'}</td>
              <td className="px-3 py-2.5">
              <label className="flex shrink-0 items-center gap-2 text-xs text-slate-600">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-slate-300"
                  checked={account.enabled}
                  aria-label={t('toggleAccount', { name: account.label })}
                  disabled={!canManage || busy === account.id || !account.connected}
                  onChange={(event) =>
                    call(account.id, `${togglePath}/${account.id}`, 'PATCH', {
                      enabled: event.target.checked,
                    })
                  }
                />
                {account.connected ? (account.enabled ? t('active') : t('paused')) : t('reconnectRequired')}
              </label>
              </td>
              <td className="px-3 py-2.5 text-end">{canManage && <button type="button" className="btn-ghost text-xs text-red-700" disabled={busy === account.id} onClick={() => onRemove(account)}>{t('disconnect')}</button>}</td>
            </tr>
          ))}
          </tbody>
        </table></div>
      )}
    </section>
  );
}
