'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { Icon } from './Icon';

type StepId = 'account' | 'facebookApp' | 'connect' | 'destination' | 'email';

interface SetupStep {
  id: StepId;
  done: boolean;
  optional: boolean;
}

interface SetupState {
  firstRun: boolean;
  steps: SetupStep[];
  complete: boolean;
  nextStep: StepId | null;
}

/**
 * The setup checklist.
 *
 * Every step is visible from the start, including the ones already done. A
 * wizard that reveals one step at a time hides how much is left, and somebody
 * installing this on a Friday afternoon deserves to know that before they
 * start rather than after the third screen.
 *
 * Exactly one step is open at a time — the first unfinished one — because a
 * page of five expanded forms is a worse answer to "what do I do now" than a
 * page with one.
 */
export function SetupClient({ state, signedIn }: { state: SetupState; signedIn: boolean }) {
  const t = useTranslations('setup');
  const router = useRouter();

  const [appId, setAppId] = useState('');
  const [appSecret, setAppSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function saveApp(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const response = await fetch('/api/setup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ facebookAppId: appId, facebookAppSecret: appSecret }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };

      if (!response.ok) {
        setError(payload.error ?? t('saveFailed'));
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      {state.steps.map((step, index) => {
        const open = step.id === state.nextStep;

        return (
          <section
            key={step.id}
            className={`rounded-xl border p-4 ${
              open ? 'border-brand-300 bg-brand-50/40' : 'border-slate-200'
            }`}
          >
            <div className="flex items-start gap-3">
              {/* Done, current, or not yet — legible at a glance without
                  reading a word of it. */}
              <span
                className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                  step.done
                    ? 'bg-emerald-100 text-emerald-700'
                    : open
                      ? 'bg-brand-600 text-white'
                      : 'bg-slate-100 text-slate-500'
                }`}
              >
                {step.done ? <Icon name="check" className="h-3.5 w-3.5" /> : index + 1}
              </span>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2
                    className={`text-sm font-semibold ${step.done ? 'text-slate-500' : 'text-slate-900'}`}
                  >
                    {t(`steps.${step.id}.title`)}
                  </h2>
                  {step.optional && (
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                      {t('optional')}
                    </span>
                  )}
                </div>

                <p className="mt-1 text-sm text-slate-600">
                  {step.done ? t(`steps.${step.id}.done`) : t(`steps.${step.id}.body`)}
                </p>

                {open && (
                  <div className="mt-3">
                    {step.id === 'account' && (
                      <Link href="/register" className="btn-primary inline-flex">
                        {t('steps.account.action')}
                      </Link>
                    )}

                    {step.id === 'facebookApp' && (
                      <form onSubmit={saveApp} className="space-y-3">
                        <p className="text-xs text-slate-500">{t('steps.facebookApp.hint')}</p>
                        <div>
                          <label className="label" htmlFor="appId">
                            {t('steps.facebookApp.appId')}
                          </label>
                          <input
                            id="appId"
                            className="input"
                            value={appId}
                            onChange={(event) => setAppId(event.target.value)}
                            autoComplete="off"
                            required
                          />
                        </div>
                        <div>
                          <label className="label" htmlFor="appSecret">
                            {t('steps.facebookApp.appSecret')}
                          </label>
                          <input
                            id="appSecret"
                            type="password"
                            className="input"
                            value={appSecret}
                            onChange={(event) => setAppSecret(event.target.value)}
                            autoComplete="off"
                            required
                          />
                        </div>
                        <button type="submit" className="btn-primary" disabled={busy}>
                          {busy ? t('saving') : t('steps.facebookApp.action')}
                        </button>
                      </form>
                    )}

                    {step.id === 'connect' &&
                      (signedIn ? (
                        <a href="/api/facebook/connect" className="btn-primary inline-flex">
                          {t('steps.connect.action')}
                        </a>
                      ) : (
                        <Link href="/login" className="btn-primary inline-flex">
                          {t('signInFirst')}
                        </Link>
                      ))}

                    {step.id === 'destination' && (
                      <Link href="/connections" className="btn-primary inline-flex">
                        {t('steps.destination.action')}
                      </Link>
                    )}

                    {step.id === 'email' && (
                      <Link href="/settings/config" className="btn-secondary inline-flex">
                        {t('steps.email.action')}
                      </Link>
                    )}
                  </div>
                )}

                {error && open && <p className="mt-2 text-sm text-red-600">{error}</p>}
              </div>
            </div>
          </section>
        );
      })}

      {state.complete && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
          <p className="text-sm font-medium text-emerald-900">{t('readyTitle')}</p>
          <p className="mt-1 text-sm text-emerald-800">{t('readyBody')}</p>
          <Link href="/compose" className="btn-primary mt-3 inline-flex">
            {t('readyAction')}
          </Link>
        </div>
      )}
    </div>
  );
}
