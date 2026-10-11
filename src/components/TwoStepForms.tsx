'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { startAuthentication, startRegistration } from '@simplewebauthn/browser';

import { Icon } from './Icon';
import { afterAuthPath } from '@/lib/invite-path';

async function post<T>(url: string, body?: unknown): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    });
    const data = (await response.json().catch(() => ({}))) as T & { error?: string };
    return response.ok ? { ok: true, data } : { ok: false, error: data.error ?? `HTTP ${response.status}` };
  } catch {
    return { ok: false, error: 'network' };
  }
}

function ErrorLine({ error }: { error: string | null }) {
  const t = useTranslations('twoStep');
  if (!error) return null;
  return (
    <p role="alert" className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
      <Icon name="error" size={14} className="mt-0.5 shrink-0" /> {error === 'network' ? t('networkError') : error}
    </p>
  );
}

/** The second step at sign-in: a code from the app or a recovery code, or a passkey. */
export function TwoStepVerify({
  hasPasskey,
  hasTotp,
  inviteToken,
}: {
  hasPasskey: boolean;
  hasTotp: boolean;
  inviteToken?: string;
}) {
  const t = useTranslations('twoStep');
  const router = useRouter();
  const [code, setCode] = useState('');
  const [remember, setRemember] = useState(false);
  const [recovery, setRecovery] = useState(!hasTotp && !hasPasskey);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function done() {
    router.replace(afterAuthPath(inviteToken));
    router.refresh();
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result = await post('/api/auth/two-step/verify', { code, remember });
    setBusy(false);
    if (result.ok) done();
    else setError(result.error);
  }

  async function passkey() {
    setBusy(true);
    setError(null);
    const options = await post<{ options: Parameters<typeof startAuthentication>[0]['optionsJSON'] }>('/api/auth/passkeys/login/options');
    if (!options.ok) {
      setBusy(false);
      setError(options.error);
      return;
    }
    try {
      const response = await startAuthentication({ optionsJSON: options.data.options });
      const result = await post('/api/auth/passkeys/login/verify', { response, remember });
      if (result.ok) return done();
      setError(result.error);
    } catch {
      setError(t('passkeyCancelled'));
    }
    setBusy(false);
  }

  return (
    <div className="space-y-4">
      {hasPasskey && (
        <button type="button" className="btn-primary w-full" disabled={busy} onClick={() => void passkey()}>
          <Icon name="key" size={16} /> {t('usePasskey')}
        </button>
      )}
      {(hasTotp || recovery) && (
        <form className="space-y-3" onSubmit={submit}>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-900">{recovery ? t('recoveryLabel') : t('codeLabel')}</span>
            <input
              className="input text-center text-lg tracking-widest"
              value={code}
              required
              autoFocus
              spellCheck={false}
              autoComplete="one-time-code"
              inputMode={recovery ? 'text' : 'numeric'}
              placeholder={recovery ? 'xxxxx-xxxxx' : '123456'}
              onChange={(event) => setCode(event.target.value)}
            />
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" className="h-4 w-4 rounded border-slate-300" checked={remember} onChange={(event) => setRemember(event.target.checked)} />
            {t('remember', { days: 30 })}
          </label>
          <ErrorLine error={error} />
          <button type="submit" className={hasPasskey ? 'btn-secondary w-full' : 'btn-primary w-full'} disabled={busy || !code.trim()}>
            {busy ? t('checking') : t('verify')}
          </button>
        </form>
      )}
      {!recovery && (
        <button type="button" className="btn-ghost w-full text-sm" onClick={() => setRecovery(true)}>
          {t('useRecovery')}
        </button>
      )}
      {!hasTotp && !recovery && <ErrorLine error={error} />}
    </div>
  );
}

/** Recovery codes, shown once, with copy and download. */
export function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone?: () => void }) {
  const t = useTranslations('twoStep');
  const [copied, setCopied] = useState(false);
  const text = codes.join('\n');
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-700">{t('codesIntro', { count: codes.length })}</p>
      <ol className="grid grid-cols-2 gap-2 rounded-lg bg-slate-50 p-3 font-mono text-sm text-slate-900" translate="no">
        {codes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn-secondary"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(text);
              setCopied(true);
            } catch {
              setCopied(false);
            }
          }}
        >
          <Icon name="check" size={14} /> {copied ? t('copied') : t('copy')}
        </button>
        <a className="btn-secondary" download="recovery-codes.txt" href={`data:text/plain;charset=utf-8,${encodeURIComponent(text)}`}>
          <Icon name="download" size={14} /> {t('download')}
        </a>
        {onDone && (
          <button type="button" className="btn-primary" onClick={onDone}>
            {t('savedThem')}
          </button>
        )}
      </div>
    </div>
  );
}

/** Set up an authenticator app: scan, type a code, get recovery codes. */
export function TotpSetup({ onFinished }: { onFinished: (codes: string[]) => void }) {
  const t = useTranslations('twoStep');
  const [setup, setSetup] = useState<{ secret: string; qr: string } | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const result = await post<{ secret: string; qr: string }>('/api/auth/two-step/totp/start');
      if (result.ok) setSetup(result.data);
      else setError(result.error);
    })();
  }, []);

  async function confirm(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result = await post<{ recoveryCodes: string[] }>('/api/auth/two-step/totp/confirm', { code });
    setBusy(false);
    if (result.ok) onFinished(result.data.recoveryCodes);
    else setError(result.error);
  }

  return (
    <div className="space-y-4">
      <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-700">
        <li>{t('setupStep1')}</li>
        <li>{t('setupStep2')}</li>
        <li>{t('setupStep3')}</li>
      </ol>
      {setup ? (
        <div className="flex flex-col items-center gap-2">
          <img src={setup.qr} alt={t('qrAlt')} width={192} height={192} className="rounded-lg border border-slate-200 bg-white p-2" />
          <p className="text-xs text-slate-500">{t('cantScan')}</p>
          <code className="break-all rounded bg-slate-100 px-2 py-1 text-xs text-slate-900" translate="no">{setup.secret}</code>
        </div>
      ) : (
        !error && <p className="text-sm text-slate-500">{t('preparing')}</p>
      )}
      <form className="space-y-3" onSubmit={confirm}>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-900">{t('codeLabel')}</span>
          <input
            className="input text-center text-lg tracking-widest"
            value={code}
            required
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="123456"
            onChange={(event) => setCode(event.target.value)}
          />
        </label>
        <ErrorLine error={error} />
        <button type="submit" className="btn-primary w-full" disabled={busy || !setup || !code.trim()}>
          {busy ? t('checking') : t('turnOn')}
        </button>
      </form>
    </div>
  );
}

/** Add a passkey to the signed-in account. */
export function AddPasskey({ onAdded }: { onAdded: (recoveryCodes: string[]) => void }) {
  const t = useTranslations('twoStep');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    setBusy(true);
    setError(null);
    const options = await post<{ options: Parameters<typeof startRegistration>[0]['optionsJSON'] }>('/api/auth/passkeys/register/options');
    if (!options.ok) {
      setBusy(false);
      setError(options.error);
      return;
    }
    try {
      const response = await startRegistration({ optionsJSON: options.data.options });
      const result = await post<{ recoveryCodes: string[] }>('/api/auth/passkeys/register/verify', {
        response,
        name: name.trim() || t('passkeyDefaultName'),
      });
      if (result.ok) {
        setName('');
        onAdded(result.data.recoveryCodes);
      } else setError(result.error);
    } catch {
      setError(t('passkeyCancelled'));
    }
    setBusy(false);
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <label className="sr-only" htmlFor="passkey-name">{t('passkeyName')}</label>
        <input
          id="passkey-name"
          className="input min-w-0 flex-1"
          value={name}
          maxLength={60}
          autoComplete="off"
          placeholder={t('passkeyNamePlaceholder')}
          onChange={(event) => setName(event.target.value)}
        />
        <button type="button" className="btn-secondary" disabled={busy} onClick={() => void add()}>
          <Icon name="plus" size={14} /> {t('addPasskey')}
        </button>
      </div>
      <ErrorLine error={error} />
    </div>
  );
}

/** Setting up the second step an account must have, right after its password. */
export function TwoStepEnroll({ inviteToken }: { inviteToken?: string }) {
  const t = useTranslations('twoStep');
  const router = useRouter();
  const [codes, setCodes] = useState<string[] | null>(null);
  const [method, setMethod] = useState<'app' | 'passkey'>('app');

  function done() {
    router.replace(afterAuthPath(inviteToken));
    router.refresh();
  }

  if (codes) {
    return codes.length > 0 ? <RecoveryCodes codes={codes} onDone={done} /> : (
      <button type="button" className="btn-primary w-full" onClick={done}>{t('continue')}</button>
    );
  }

  return (
    <div className="space-y-4">
      <div className="segmented w-full" role="group" aria-label={t('method')}>
        {(['app', 'passkey'] as const).map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={method === value}
            className={`segmented-item flex-1 ${method === value ? 'segmented-item-active' : ''}`}
            onClick={() => setMethod(value)}
          >
            {value === 'app' ? t('methodApp') : t('methodPasskey')}
          </button>
        ))}
      </div>
      {method === 'app' ? (
        <TotpSetup onFinished={setCodes} />
      ) : (
        <div className="space-y-2">
          <p className="text-sm text-slate-700">{t('passkeyIntro')}</p>
          <AddPasskey onAdded={(added) => setCodes(added)} />
        </div>
      )}
    </div>
  );
}

export interface TwoStepState {
  totp: string | null;
  recoveryCodes: number;
  passkeys: Array<{ id: string; name: string; createdAt: string; lastUsedAt: string | null }>;
  trustedDevices: number;
  required: boolean;
}

/** Settings → Account: two-step sign-in, passkeys, recovery codes, remembered devices. */
export function TwoStepSettings({ initial }: { initial: TwoStepState }) {
  const t = useTranslations('twoStep');
  const router = useRouter();
  const [mode, setMode] = useState<'idle' | 'setup' | 'codes' | 'disable' | 'regenerate'>('idle');
  const [codes, setCodes] = useState<string[]>([]);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const on = Boolean(initial.totp) || initial.passkeys.length > 0;

  function refresh(text?: string) {
    setMessage(text ?? null);
    router.refresh();
  }

  async function withPassword(url: string, then: (data: { recoveryCodes?: string[] }) => void) {
    setBusy(true);
    setError(null);
    const result = await post<{ recoveryCodes?: string[] }>(url, { password });
    setBusy(false);
    if (!result.ok) return setError(result.error);
    setPassword('');
    then(result.data);
  }

  async function remove(url: string, method: 'DELETE', text: string) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(url, { method });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) setError(data.error ?? `HTTP ${response.status}`);
      else refresh(text);
    } catch {
      setError('network');
    }
    setBusy(false);
  }

  return (
    <section className="card space-y-4 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-slate-900">{t('settingsTitle')}</h2>
          <p className="mt-0.5 text-sm text-slate-600">
            {on ? t('settingsOn') : initial.required ? t('settingsRequired') : t('settingsOff')}
          </p>
        </div>
        <span className={`badge ${on ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
          {on ? t('on') : t('off')}
        </span>
      </div>

      {message && (
        <p role="status" className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          <Icon name="check" size={14} /> {message}
        </p>
      )}
      <ErrorLine error={error} />

      {mode === 'setup' && (
        <TotpSetup
          onFinished={(newCodes) => {
            setCodes(newCodes);
            setMode(newCodes.length ? 'codes' : 'idle');
            refresh(t('appOn'));
          }}
        />
      )}
      {mode === 'codes' && <RecoveryCodes codes={codes} onDone={() => setMode('idle')} />}

      {mode === 'idle' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-slate-900">{t('appTitle')}</p>
              <p className="text-xs text-slate-500">{initial.totp ? t('appSet') : t('appNotSet')}</p>
            </div>
            <button type="button" className="btn-secondary" onClick={() => setMode('setup')}>
              {initial.totp ? t('appReplace') : t('appSetUp')}
            </button>
          </div>

          <div className="space-y-2 border-t border-slate-100 pt-3">
            <p className="text-sm font-medium text-slate-900">{t('passkeysTitle')}</p>
            {initial.passkeys.length === 0 ? (
              <p className="text-xs text-slate-500">{t('passkeysNone')}</p>
            ) : (
              <ul className="divide-y divide-slate-100 text-sm">
                {initial.passkeys.map((passkey) => (
                  <li key={passkey.id} className="flex items-center justify-between gap-2 py-1.5">
                    <span className="min-w-0 truncate text-slate-900">{passkey.name}</span>
                    <button
                      type="button"
                      className="btn-ghost h-9 text-red-700"
                      disabled={busy}
                      onClick={() => void remove(`/api/auth/passkeys/${passkey.id}`, 'DELETE', t('passkeyRemoved'))}
                    >
                      {t('remove')}
                      <span className="sr-only"> {passkey.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <AddPasskey
              onAdded={(newCodes) => {
                if (newCodes.length) {
                  setCodes(newCodes);
                  setMode('codes');
                }
                refresh(t('passkeyAdded'));
              }}
            />
          </div>

          {on && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-900">{t('codesTitle')}</p>
                <p className="text-xs text-slate-500">{t('codesLeft', { count: initial.recoveryCodes })}</p>
              </div>
              <button type="button" className="btn-secondary" onClick={() => setMode('regenerate')}>
                {t('codesNew')}
              </button>
            </div>
          )}

          {initial.trustedDevices > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
              <p className="min-w-0 text-sm text-slate-700">{t('devices', { count: initial.trustedDevices })}</p>
              <button
                type="button"
                className="btn-secondary"
                disabled={busy}
                onClick={() => void remove('/api/auth/two-step/devices', 'DELETE', t('devicesForgotten'))}
              >
                {t('devicesForget')}
              </button>
            </div>
          )}

          {on && !initial.required && (
            <div className="border-t border-slate-100 pt-3">
              <button type="button" className="btn-ghost text-red-700" onClick={() => setMode('disable')}>
                {t('turnOff')}
              </button>
            </div>
          )}
        </div>
      )}

      {(mode === 'disable' || mode === 'regenerate') && (
        <form
          className="space-y-3 border-t border-slate-100 pt-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (mode === 'disable') {
              void withPassword('/api/auth/two-step/disable', () => {
                setMode('idle');
                refresh(t('turnedOff'));
              });
            } else {
              void withPassword('/api/auth/two-step/recovery-codes', (data) => {
                setCodes(data.recoveryCodes ?? []);
                setMode('codes');
                refresh();
              });
            }
          }}
        >
          <p className="text-sm text-slate-700">{mode === 'disable' ? t('turnOffHint') : t('codesNewHint')}</p>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-900">{t('password')}</span>
            <input
              type="password"
              className="input"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <div className="flex gap-2">
            <button type="submit" className={mode === 'disable' ? 'btn-primary bg-red-600 hover:bg-red-700' : 'btn-primary'} disabled={busy || !password}>
              {mode === 'disable' ? t('turnOff') : t('codesNew')}
            </button>
            <button type="button" className="btn-ghost" onClick={() => setMode('idle')}>
              {t('cancel')}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
