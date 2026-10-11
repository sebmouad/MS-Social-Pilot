'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useTranslations } from 'next-intl';

import { Dialog } from './Dialog';
import { FeedAvatar } from './FeedPost';
import { Icon } from './Icon';
import { NetworkMark } from './NetworkMark';

type NetworkKey = 'bluesky' | 'mastodon' | 'linkedin' | 'threads' | 'x' | 'pinterest';

interface Account {
  id: string;
  network: NetworkKey;
  name: string;
  pictureUrl: string | null;
  invalidReason: string | null;
  targets: Array<{ id: string; name: string; category: string | null; enabled: boolean }>;
}

/**
 * Every network besides Facebook, one card each: what is connected, and the
 * way to connect more. Networks that need a developer app this installation
 * has not been given say so, and send the owner to Configuration.
 */
export function OtherNetworks({
  networks,
  accounts,
  canManage,
  isOwner,
  notice,
}: {
  networks: Array<{ key: NetworkKey; label: string; available: boolean }>;
  accounts: Account[];
  canManage: boolean;
  isOwner: boolean;
  notice: { network: NetworkKey; error: string | null; connected: string | null } | null;
}) {
  const t = useTranslations('networks');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const [dialog, setDialog] = useState<'bluesky' | 'mastodon' | null>(null);
  const [identifier, setIdentifier] = useState('');
  const [appPassword, setAppPassword] = useState('');
  const [instance, setInstance] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<Account | null>(null);

  async function connectBluesky() {
    setPending(true);
    setError(null);
    const response = await fetch('/api/networks/bluesky', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ identifier, appPassword }),
    }).catch(() => null);
    setPending(false);
    const body = (await response?.json().catch(() => ({}))) as { error?: string; fields?: Record<string, string> } | undefined;
    if (!response?.ok) {
      setError(Object.values(body?.fields ?? {})[0] ?? body?.error ?? tCommon('genericError'));
      return;
    }
    setAppPassword('');
    setDialog(null);
    router.refresh();
  }

  async function toggle(targetId: string, enabled: boolean) {
    await fetch(`/api/targets/${targetId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled }),
    }).catch(() => null);
    router.refresh();
  }

  async function remove(account: Account) {
    await fetch(`/api/accounts/${account.id}`, { method: 'DELETE' }).catch(() => null);
    setRemoving(null);
    router.refresh();
  }

  return (
    <section className="space-y-3" aria-labelledby="networks-title">
      <div>
        <h2 id="networks-title" className="text-[17px] font-bold text-slate-900">
          {t('title')}
        </h2>
        <p className="text-sm text-slate-600">{t('subtitle')}</p>
      </div>

      {notice && (
        <p
          role="status"
          className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
            notice.error ? 'border-red-200 bg-red-50 text-red-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'
          }`}
        >
          <Icon name={notice.error ? 'error' : 'check'} />
          {notice.error
            ? t('connectFailed', { network: networks.find((entry) => entry.key === notice.network)?.label ?? notice.network, error: notice.error })
            : t('connectedNotice', {
                network: networks.find((entry) => entry.key === notice.network)?.label ?? notice.network,
                count: Number(notice.connected ?? 0),
              })}
        </p>
      )}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {networks.map((network) => {
          const mine = accounts.filter((account) => account.network === network.key);
          return (
            <article key={network.key} className="card flex flex-col p-4">
              <header className="flex items-center gap-3">
                <NetworkMark network={network.key} size={36} />
                <div className="min-w-0 flex-1">
                  <h3 className="text-[15px] font-semibold text-slate-900">{network.label}</h3>
                  <p className="text-xs text-slate-500">{t(`hint_${network.key}`)}</p>
                </div>
              </header>

              {mine.length > 0 && (
                <ul className="mt-3 space-y-2">
                  {mine.map((account) => (
                    <li key={account.id} className="rounded-lg border border-slate-200 p-2.5">
                      <div className="flex items-center gap-2">
                        <FeedAvatar name={account.name} pictureUrl={account.pictureUrl} size="sm" />
                        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-900">{account.name}</span>
                        {canManage && (
                          <button type="button" className="btn-ghost px-2 py-1 text-xs hover:text-red-600" onClick={() => setRemoving(account)}>
                            {t('disconnect')}
                          </button>
                        )}
                      </div>
                      {account.invalidReason && <p className="mt-1 text-xs text-red-600">{account.invalidReason}</p>}
                      <ul className="mt-2 space-y-1">
                        {account.targets.map((target) => (
                          <li key={target.id} className="flex items-center gap-2 text-xs text-slate-700">
                            <input
                              type="checkbox"
                              className="h-4 w-4 rounded border-slate-300 text-brand-500 focus:ring-brand-500"
                              checked={target.enabled}
                              disabled={!canManage}
                              aria-label={t('useTarget', { name: target.name })}
                              onChange={() => void toggle(target.id, !target.enabled)}
                            />
                            <span className="min-w-0 flex-1 truncate">{target.name}</span>
                            {target.category && <span className="shrink-0 text-slate-400">{target.category}</span>}
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              )}

              <div className="mt-auto pt-3">
                {!canManage ? null : network.key === 'bluesky' || network.key === 'mastodon' ? (
                  <button type="button" className="btn-secondary w-full" onClick={() => setDialog(network.key as 'bluesky' | 'mastodon')}>
                    <Icon name="plus" size={16} />
                    {mine.length ? t('connectAnother') : t('connect', { network: network.label })}
                  </button>
                ) : network.available ? (
                  <div className="flex gap-2">
                    {/* A full navigation: the route redirects to the network's sign-in. */}
                    <a href={`/api/networks/${network.key}/connect`} className="btn-secondary flex-1">
                      <Icon name="plus" size={16} />
                      {mine.length ? t('connectAnother') : t('connect', { network: network.label })}
                    </a>
                    {network.key === 'linkedin' && (
                      <a href="/api/networks/linkedin/connect?organizations=1" className="btn-ghost text-xs" title={t('linkedinPagesHint')}>
                        {t('linkedinPages')}
                      </a>
                    )}
                  </div>
                ) : (
                  <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                    {isOwner ? (
                      <>
                        {t('needsApp', { network: network.label })}{' '}
                        <Link href="/settings/config" className="font-semibold text-brand-600 hover:underline">
                          {t('openConfig')}
                        </Link>
                      </>
                    ) : (
                      t('needsAppAskOwner', { network: network.label })
                    )}
                  </p>
                )}
              </div>
            </article>
          );
        })}
      </div>

      <Dialog
        open={dialog === 'bluesky'}
        title={t('blueskyTitle')}
        onClose={() => setDialog(null)}
        closeLabel={tCommon('close')}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setDialog(null)}>
              {tCommon('cancel')}
            </button>
            <button type="button" className="btn-primary" disabled={pending || !identifier.trim() || !appPassword.trim()} onClick={() => void connectBluesky()}>
              {pending ? tCommon('working') : t('connect', { network: 'Bluesky' })}
            </button>
          </>
        }
      >
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void connectBluesky();
          }}
        >
          <p className="text-sm text-slate-600">{t('blueskyHint')}</p>
          {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <label className="block text-sm">
            <span className="label">{t('blueskyHandle')}</span>
            <input className="input" autoComplete="off" placeholder="yourname.bsky.social" value={identifier} onChange={(event) => setIdentifier(event.target.value)} />
          </label>
          <label className="block text-sm">
            <span className="label">{t('blueskyAppPassword')}</span>
            <input
              className="input font-mono"
              type="password"
              autoComplete="off"
              placeholder="xxxx-xxxx-xxxx-xxxx"
              value={appPassword}
              onChange={(event) => setAppPassword(event.target.value)}
            />
            <span className="hint">{t('blueskyAppPasswordHint')}</span>
          </label>
        </form>
      </Dialog>

      <Dialog
        open={dialog === 'mastodon'}
        title={t('mastodonTitle')}
        onClose={() => setDialog(null)}
        closeLabel={tCommon('close')}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setDialog(null)}>
              {tCommon('cancel')}
            </button>
            <a
              href={`/api/networks/mastodon/connect?instance=${encodeURIComponent(instance.trim())}`}
              className={`btn-primary ${instance.trim().length < 4 ? 'pointer-events-none opacity-50' : ''}`}
              aria-disabled={instance.trim().length < 4}
            >
              {t('mastodonContinue')}
            </a>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-slate-600">{t('mastodonHint')}</p>
          <label className="block text-sm">
            <span className="label">{t('mastodonServer')}</span>
            <input className="input" placeholder="mastodon.social" value={instance} onChange={(event) => setInstance(event.target.value)} />
          </label>
        </div>
      </Dialog>

      <Dialog
        open={removing !== null}
        title={removing ? t('disconnectTitle', { name: removing.name }) : ''}
        onClose={() => setRemoving(null)}
        closeLabel={tCommon('close')}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setRemoving(null)}>
              {tCommon('cancel')}
            </button>
            <button type="button" className="btn-primary bg-red-600 hover:bg-red-700" onClick={() => removing && void remove(removing)}>
              {t('disconnect')}
            </button>
          </>
        }
      >
        <p className="text-sm text-slate-700">{t('disconnectHint')}</p>
      </Dialog>
    </section>
  );
}
