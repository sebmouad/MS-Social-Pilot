'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { CLIENT_SWITCHES, type ClientSwitch } from '@/lib/role-access';

/**
 * What the workspace's clients may open beyond the calendar, their posts and
 * approvals. Each switch saves on its own, so there is no form to forget.
 */
export function ClientAccess({ initial }: { initial: string[] }) {
  const t = useTranslations('team.clientAccess');
  const router = useRouter();
  const [access, setAccess] = useState<string[]>(initial);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function toggle(key: ClientSwitch, on: boolean) {
    const next = on ? [...access, key] : access.filter((item) => item !== key);
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch('/api/workspace', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ clientAccess: next }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setMessage({ ok: false, text: body.error ?? t('failed') });
        return;
      }
      setAccess(next);
      setMessage({ ok: true, text: t('saved') });
      router.refresh();
    } catch {
      setMessage({ ok: false, text: t('failed') });
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="card p-5" aria-labelledby="client-access-title">
      <h2 id="client-access-title" className="text-[15px] font-semibold text-slate-900">
        {t('title')}
      </h2>
      <p className="mt-1 text-xs text-slate-600">{t('hint')}</p>
      <div className="mt-3 space-y-2">
        {CLIENT_SWITCHES.map((key) => (
          <label key={key} className="flex items-start gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-500"
              checked={access.includes(key)}
              disabled={pending}
              onChange={(event) => void toggle(key, event.target.checked)}
            />
            <span>
              {t(`switch_${key}`)}
              <span className="block text-xs text-slate-500">{t(`switch_${key}Hint`)}</span>
            </span>
          </label>
        ))}
      </div>
      {message && (
        <p role={message.ok ? 'status' : 'alert'} className={`mt-3 text-xs ${message.ok ? 'text-emerald-700' : 'text-red-700'}`}>
          {message.text}
        </p>
      )}
    </section>
  );
}
