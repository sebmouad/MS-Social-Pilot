'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';

import { Dialog } from './Dialog';

const EVENTS = ['publishFailure', 'connectionExpired', 'approvalRequest', 'approvalDecision', 'reviewDecision'] as const;
type Event = (typeof EVENTS)[number];

interface Channel {
  id: string;
  kind: 'slack' | 'telegram';
  name: string;
  events: Event[];
  enabled: boolean;
  lastError: string | null;
  lastSent: string | null;
}

const LOGO: Record<Channel['kind'], { label: string; tone: string }> = {
  slack: { label: '#', tone: 'bg-[#4a154b] text-white' },
  telegram: { label: '✈', tone: 'bg-[#229ed9] text-white' },
};

/**
 * Slack and Telegram, beside email: the alerts a team acts on, where the team
 * already talks. Adding one sends a test at once, so a wrong id shows now and
 * not the night a post fails.
 */
export function ChatChannelsClient({ channels }: { channels: Channel[] }) {
  const t = useTranslations('notifications');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<Channel['kind']>('slack');
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [botToken, setBotToken] = useState('');
  const [chatId, setChatId] = useState('');
  const [events, setEvents] = useState<Event[]>(['publishFailure', 'connectionExpired', 'approvalRequest', 'reviewDecision']);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<{ id: string; text: string; bad: boolean } | null>(null);
  const close = useCallback(() => {
    setOpen(false);
    setError(null);
  }, []);

  async function add() {
    setPending(true);
    setError(null);
    const response = await fetch('/api/chat-channels', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(kind === 'slack' ? { kind, name, url, events } : { kind, name, botToken, chatId, events }),
    }).catch(() => null);
    setPending(false);
    const body = (await response?.json().catch(() => ({}))) as { id?: string; testError?: string | null; error?: string; fields?: Record<string, string> } | undefined;
    if (!response?.ok || !body?.id) {
      setError(Object.values(body?.fields ?? {})[0] ?? body?.error ?? tCommon('genericError'));
      return;
    }
    setNotice({ id: body.id, text: body.testError ? t('chatTestFailed', { error: body.testError }) : t('chatTestSent'), bad: Boolean(body.testError) });
    setUrl('');
    setBotToken('');
    setName('');
    setOpen(false);
    router.refresh();
  }

  async function patch(channel: Channel, data: Partial<Pick<Channel, 'enabled' | 'events'>>) {
    await fetch(`/api/chat-channels/${channel.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(data),
    }).catch(() => null);
    router.refresh();
  }

  async function test(channel: Channel) {
    const response = await fetch(`/api/chat-channels/${channel.id}/test`, { method: 'POST' }).catch(() => null);
    const body = (await response?.json().catch(() => ({}))) as { error?: string | null } | undefined;
    setNotice({ id: channel.id, text: body?.error ? t('chatTestFailed', { error: body.error }) : t('chatTestSent'), bad: Boolean(body?.error) });
    router.refresh();
  }

  async function remove(channel: Channel) {
    await fetch(`/api/chat-channels/${channel.id}`, { method: 'DELETE' }).catch(() => null);
    router.refresh();
  }

  const toggle = (list: Event[], event: Event) => (list.includes(event) ? list.filter((value) => value !== event) : [...list, event]);

  return (
    <section className="card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
        <div>
          <h2 className="text-[15px] font-semibold text-slate-900">{t('chatTitle')}</h2>
          <p className="text-xs text-slate-500">{t('chatHint')}</p>
        </div>
        <button type="button" className="btn-primary" onClick={() => setOpen(true)}>
          {t('chatAdd')}
        </button>
      </div>

      {channels.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-slate-500">{t('chatNone')}</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {channels.map((channel) => (
            <li key={channel.id} className="space-y-2 px-4 py-3">
              <div className="flex flex-wrap items-center gap-3">
                <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-base font-bold ${LOGO[channel.kind].tone}`} aria-hidden>
                  {LOGO[channel.kind].label}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-slate-900">
                    {channel.name} <span className="font-normal text-slate-500">· {t(`chatKind_${channel.kind}`)}</span>
                  </span>
                  <span className={`block truncate text-xs ${channel.lastError ? 'text-red-600' : 'text-slate-500'}`}>
                    {channel.lastError ?? (channel.lastSent ? t('chatLastSent', { when: channel.lastSent }) : t('chatNever'))}
                  </span>
                </span>
                <label className="flex items-center gap-2 text-xs font-semibold text-slate-700">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-slate-300 text-brand-500 focus:ring-brand-500"
                    checked={channel.enabled}
                    onChange={() => void patch(channel, { enabled: !channel.enabled })}
                  />
                  {t('chatOn')}
                </label>
                <button type="button" className="btn-secondary px-3 py-1 text-xs" onClick={() => void test(channel)}>
                  {t('chatTest')}
                </button>
                <button type="button" className="btn-ghost px-2 py-1 text-xs hover:text-red-600" onClick={() => void remove(channel)}>
                  {t('chatRemove')}
                </button>
              </div>
              {notice?.id === channel.id && (
                <p className={`rounded-lg px-3 py-1.5 text-xs ${notice.bad ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`} role="status">
                  {notice.text}
                </p>
              )}
              <div className="flex flex-wrap gap-1.5 ps-12">
                {EVENTS.map((event) => {
                  const on = channel.events.includes(event);
                  return (
                    <button
                      key={event}
                      type="button"
                      aria-pressed={on}
                      disabled={on && channel.events.length === 1}
                      className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                        on ? 'bg-brand-50 text-brand-700 ring-1 ring-brand-200' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                      }`}
                      onClick={() => void patch(channel, { events: toggle(channel.events, event) })}
                    >
                      {t(`chatEvent_${event}`)}
                    </button>
                  );
                })}
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog
        open={open}
        title={t('chatAdd')}
        onClose={close}
        closeLabel={tCommon('close')}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={close}>
              {tCommon('cancel')}
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={pending || !name.trim() || events.length === 0 || (kind === 'slack' ? !url.trim() : !botToken.trim() || !chatId.trim())}
              onClick={() => void add()}
            >
              {pending ? tCommon('working') : t('chatAddAndTest')}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <div className="segmented w-fit" role="radiogroup" aria-label={t('chatKind')}>
            {(['slack', 'telegram'] as const).map((value) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={kind === value}
                className={`segmented-item ${kind === value ? 'segmented-item-active' : ''}`}
                onClick={() => setKind(value)}
              >
                {t(`chatKind_${value}`)}
              </button>
            ))}
          </div>
          <label className="block text-sm">
            <span className="label">{t('chatName')}</span>
            <input className="input" maxLength={60} placeholder={kind === 'slack' ? '#social-team' : 'Équipe social'} value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          {kind === 'slack' ? (
            <label className="block text-sm">
              <span className="label">{t('chatSlackUrl')}</span>
              <input className="input font-mono text-xs" placeholder="https://hooks.slack.com/services/…" value={url} onChange={(event) => setUrl(event.target.value)} />
              <span className="hint">{t('chatSlackHint')}</span>
            </label>
          ) : (
            <>
              <label className="block text-sm">
                <span className="label">{t('chatBotToken')}</span>
                <input className="input font-mono text-xs" placeholder="123456789:AA…" value={botToken} onChange={(event) => setBotToken(event.target.value)} />
              </label>
              <label className="block text-sm">
                <span className="label">{t('chatChatId')}</span>
                <input className="input font-mono text-xs" placeholder="-1001234567890" value={chatId} onChange={(event) => setChatId(event.target.value)} />
                <span className="hint">{t('chatTelegramHint')}</span>
              </label>
            </>
          )}
          <fieldset>
            <legend className="label">{t('chatEvents')}</legend>
            <div className="flex flex-wrap gap-1.5">
              {EVENTS.map((event) => (
                <button
                  key={event}
                  type="button"
                  aria-pressed={events.includes(event)}
                  className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                    events.includes(event) ? 'bg-brand-500 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                  onClick={() => setEvents(toggle(events, event))}
                >
                  {t(`chatEvent_${event}`)}
                </button>
              ))}
            </div>
          </fieldset>
        </div>
      </Dialog>
    </section>
  );
}
