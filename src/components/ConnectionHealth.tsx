'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';

import { Icon, type IconName } from './Icon';

type Verdict = 'ok' | 'attention' | 'broken';

interface PermissionState {
  permission: string;
  status: 'granted' | 'declined' | 'not_requested';
  required: boolean;
  label: string;
  consequence: string;
}

interface DestinationHealth {
  targetId: string;
  name: string;
  type: string;
  enabled: boolean;
  reachable: boolean;
  canPublish: boolean;
  verdict: Verdict;
  headline: string;
}

interface AccountHealthReport {
  accountId: string;
  name: string;
  tokenValid: boolean;
  expiresAt: string | null;
  dataAccessExpiresAt: string | null;
  permissions: PermissionState[];
  destinations: DestinationHealth[];
  verdict: Verdict;
  headline: string;
}

interface WorkspaceHealth {
  checkedAt: string;
  app: { configured: boolean; valid: boolean; appId: string | null; verdict: Verdict; headline: string };
  accounts: AccountHealthReport[];
}

/**
 * "Is it working, and if not, what do I do about it?"
 *
 * The question people actually have, answered in one place. Three rules hold
 * this screen together:
 *
 * 1. **Every red line says what to do.** A diagnosis nobody can act on is worse
 *    than none, because it produces a support conversation rather than a fix.
 * 2. **Problems sort to the top.** A working connection needs one line; a
 *    broken one needs the detail.
 * 3. **Facebook's vocabulary is secondary.** `pages_manage_posts` is shown, but
 *    small and after "Publish and schedule posts on your Pages" — the person
 *    deciding whether they meant to refuse it does not know the scope names.
 */
export function ConnectionHealth({ canManage }: { canManage: boolean }) {
  const t = useTranslations('connections');
  const locale = useLocale();
  const [running, setRunning] = useState(false);
  const [health, setHealth] = useState<WorkspaceHealth | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setRunning(true);
    setError(null);
    try {
      const response = await fetch('/api/connections/health', { method: 'POST' });
      const payload = (await response.json().catch(() => ({}))) as WorkspaceHealth & {
        error?: string;
      };
      if (!response.ok) {
        setError(payload.error ?? t('health.failed'));
        return;
      }
      setHealth(payload);
    } catch {
      setError(t('health.failed'));
    } finally {
      setRunning(false);
    }
  }

  if (!canManage) return null;

  const tone = (verdict: Verdict) =>
    verdict === 'ok'
      ? { chip: 'bg-emerald-100 text-emerald-800', icon: 'check' as IconName, dot: 'bg-emerald-500' }
      : verdict === 'attention'
        ? { chip: 'bg-amber-100 text-amber-800', icon: 'warning' as IconName, dot: 'bg-amber-500' }
        : { chip: 'bg-red-100 text-red-700', icon: 'error' as IconName, dot: 'bg-red-500' };

  const overall: Verdict = !health
    ? 'ok'
    : health.app.verdict === 'broken'
      ? 'broken'
      : health.accounts.some((account) => account.verdict === 'broken')
        ? 'broken'
        : health.accounts.some((account) => account.verdict === 'attention')
          ? 'attention'
          : 'ok';

  return (
    <section className="card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <Icon name="key" className="h-4 w-4 text-slate-400" />
            {t('health.title')}
          </h2>
          <p className="mt-1 text-xs text-slate-600">{t('health.subtitle')}</p>
        </div>

        <button type="button" className="btn-secondary" onClick={run} disabled={running}>
          {running ? t('health.running') : health ? t('health.again') : t('health.run')}
        </button>
      </div>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      {health && (
        <div className="mt-4 space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span className={`inline-flex h-2 w-2 rounded-full ${tone(overall).dot}`} />
            <span>{t('health.checkedAt', { when: new Date(health.checkedAt).toLocaleTimeString(locale) })}</span>
          </div>

          {/* The app itself. When this is wrong every connection below reports
              failure, so it is stated once at the top rather than eight times. */}
          <div className="rounded-lg border border-slate-200 p-3">
            <div className="flex items-start gap-2">
              <Icon name={tone(health.app.verdict).icon} className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-900">{t('health.appTitle')}</p>
                <p className="mt-0.5 text-sm text-slate-600">{health.app.headline}</p>
              </div>
            </div>
          </div>

          {health.accounts.map((account) => (
            <article key={account.accountId} className="rounded-lg border border-slate-200 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold text-slate-900">{account.name}</p>
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${tone(account.verdict).chip}`}
                >
                  <Icon name={tone(account.verdict).icon} className="h-3 w-3" />
                  {t(`health.verdict.${account.verdict}`)}
                </span>
              </div>

              <p className="mt-1 text-sm text-slate-600">{account.headline}</p>

              {account.permissions.length > 0 && (
                <div className="mt-3">
                  <p className="text-[13px] font-semibold text-slate-600">
                    {t('health.permissions')}
                  </p>
                  <ul className="mt-1.5 space-y-1.5">
                    {account.permissions.map((state) => (
                      <li key={state.permission} className="flex items-start gap-2 text-sm">
                        <Icon
                          name={state.status === 'granted' ? 'check' : state.required ? 'error' : 'close'}
                          className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${
                            state.status === 'granted'
                              ? 'text-emerald-600'
                              : state.required
                                ? 'text-red-600'
                                : 'text-slate-400'
                          }`}
                        />
                        <span className="min-w-0">
                          <span className="text-slate-800">{state.label}</span>{' '}
                          <code className="text-xs text-slate-400">{state.permission}</code>
                          {state.status !== 'granted' && (
                            <span className="block text-xs text-slate-500">
                              {state.status === 'declined'
                                ? t('health.declined', { consequence: state.consequence })
                                : t('health.notRequested', { consequence: state.consequence })}
                            </span>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {account.destinations.length > 0 && (
                <div className="mt-3">
                  <p className="text-[13px] font-semibold text-slate-600">
                    {t('health.destinations')}
                  </p>
                  <ul className="mt-1.5 space-y-1.5">
                    {account.destinations.map((destination) => (
                      <li key={destination.targetId} className="flex items-start gap-2 text-sm">
                        <span
                          className={`mt-1.5 inline-flex h-2 w-2 shrink-0 rounded-full ${tone(destination.verdict).dot}`}
                        />
                        <span className="min-w-0">
                          <span className="text-slate-800">{destination.name}</span>
                          <span className="block text-xs text-slate-500">{destination.headline}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </article>
          ))}

          {health.accounts.length === 0 && health.app.valid && (
            <p className="text-sm text-slate-600">{t('health.noAccounts')}</p>
          )}
        </div>
      )}
    </section>
  );
}
