'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { Icon } from './Icon';
import { useSavedReplies } from './SavedReplies';

export interface ThreadView {
  id: string;
  participants: string;
  updatedLabel: string;
  /** Short, for the thread list. */
  timeLabel?: string;
  /** Facebook's own one-line summary of the thread. */
  snippet?: string | null;
  messageCount: number;
  unreadCount: number;
  messages: Array<{
    id: string;
    from: string;
    /** Sent by the Page: drawn on the right, in blue, as Messenger does. */
    fromPage?: boolean;
    message: string | null;
    timeLabel?: string;
  }>;
  /** 'open' carries when Facebook's 24-hour window shuts, already formatted. */
  reply: { state: 'open'; untilLabel: string } | { state: 'closed' | 'no_recipient' };
}

/**
 * The Page inbox, laid out as Messenger lays it out: the threads down the
 * left, the open one on the right as a conversation — their messages in grey
 * on the left, the Page's in blue on the right — and the reply box under it.
 * On a phone the list comes first and the open thread under it.
 *
 * The reply box appears only on threads that can actually take one. Facebook
 * lets a Page answer within 24 hours of the person's last message and not
 * afterwards, so a box on a week-old thread is an invitation to write a
 * paragraph and have it refused. Where the box is missing the reason is on
 * screen in its place.
 */
export function InboxPanel({
  threads,
  canReply,
  pageName,
}: {
  threads: ThreadView[];
  canReply: boolean;
  /** For `{page}` in saved replies. */
  pageName: string;
}) {
  const t = useTranslations('engagement');
  const tCommon = useTranslations('common');
  const router = useRouter();

  const [selected, setSelected] = useState<string | null>(threads[0]?.id ?? null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const thread = threads.find((entry) => entry.id === selected) ?? threads[0] ?? null;
  const saved = useSavedReplies({ value: text, setValue: setText, name: thread?.participants ?? null, page: pageName });

  async function send(conversationId: string) {
    setBusy(conversationId);
    setError(null);
    try {
      const response = await fetch('/api/engagement/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ conversationId, message: text.trim() }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string };

      if (!response.ok) {
        // Graph's own words when it refuses: the window, the messaging
        // permission, a blocked Page. Each needs saying, not flattening.
        setError(body.error ?? t('replyFailed'));
        return;
      }

      setText('');
      router.refresh();
    } catch {
      // The request never arrived — offline, or the connection dropped. The
      // text stays in the box so it can be sent again.
      setError(tCommon('genericError'));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3">
      {error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="card grid overflow-hidden lg:grid-cols-[340px_minmax(0,1fr)]">
        {/* The threads. */}
        <ul className="max-h-[32rem] overflow-y-auto border-b border-slate-200 p-2 lg:max-h-[40rem] lg:border-b-0 lg:border-e">
          {threads.map((entry) => {
            const active = entry.id === thread?.id;
            const last = entry.messages[0];
            return (
              <li key={entry.id}>
                <button
                  type="button"
                  onClick={() => {
                    setSelected(entry.id);
                    setText('');
                    setError(null);
                  }}
                  aria-current={active ? 'true' : undefined}
                  className={`flex w-full items-center gap-3 rounded-lg px-2 py-2 text-start ${
                    active ? 'bg-brand-50' : 'hover:bg-slate-100'
                  }`}
                >
                  <Initial name={entry.participants} />
                  <span className="min-w-0 flex-1">
                    <span
                      className={`block truncate text-[15px] text-slate-900 ${entry.unreadCount > 0 ? 'font-bold' : 'font-semibold'}`}
                    >
                      {entry.participants}
                    </span>
                    <span
                      className={`block truncate text-[13px] ${entry.unreadCount > 0 ? 'font-semibold text-slate-900' : 'text-slate-600'}`}
                    >
                      {last?.fromPage ? `${t('you')}: ` : ''}
                      {last?.message ?? entry.snippet ?? t('attachmentOnly')}
                      {' · '}
                      {entry.timeLabel ?? entry.updatedLabel}
                    </span>
                  </span>
                  {entry.unreadCount > 0 && (
                    <span className="h-3 w-3 shrink-0 rounded-full bg-brand-500">
                      <span className="sr-only">{t('unread', { count: entry.unreadCount })}</span>
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>

        {/* The open thread. */}
        {thread && (
          <section aria-label={thread.participants} className="flex min-h-[24rem] flex-col">
            <header className="flex items-center gap-3 border-b border-slate-200 px-4 py-3">
              <Initial name={thread.participants} />
              <div className="min-w-0">
                <p className="truncate text-[15px] font-semibold text-slate-900">{thread.participants}</p>
                <p className="text-xs text-slate-500">
                  {thread.updatedLabel} · {t('messageCount', { count: thread.messageCount })}
                  {thread.unreadCount > 0 && ` · ${t('unread', { count: thread.unreadCount })}`}
                </p>
              </div>
            </header>

            <ul className="flex-1 space-y-1.5 overflow-y-auto px-4 py-4">
              {[...thread.messages].reverse().map((message) => (
                <li key={message.id} className={`flex ${message.fromPage ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[75%] ${message.fromPage ? 'text-end' : ''}`}>
                    {!message.fromPage && <span className="sr-only">{message.from}: </span>}
                    <p
                      className={`inline-block whitespace-pre-wrap rounded-[18px] px-3 py-2 text-start text-[15px] leading-5 [overflow-wrap:anywhere] ${
                        message.fromPage ? 'bg-brand-500 text-white' : 'bg-slate-100 text-slate-900'
                      }`}
                      title={message.timeLabel}
                    >
                      {message.message ?? <em>{t('attachmentOnly')}</em>}
                    </p>
                  </div>
                </li>
              ))}
            </ul>

            {canReply && (
              <div className="border-t border-slate-200 px-4 py-3">
                {thread.reply.state === 'open' ? (
                  <div className="space-y-1.5">
                    <div className="flex items-end gap-2">
                      <textarea
                        className="input min-h-[40px] flex-1 resize-y rounded-[20px] bg-slate-100 py-2"
                        aria-label={t('replyToLabel', { author: thread.participants })}
                        aria-describedby={`reply-window-${thread.id}`}
                        value={text}
                        onChange={(event) => setText(event.target.value)}
                        onKeyDown={saved.onKeyDown}
                        placeholder={t('replyPlaceholder')}
                        maxLength={2000}
                        rows={1}
                      />
                      {saved.button}
                      <button
                        type="button"
                        className="btn-primary h-10 rounded-full"
                        disabled={busy === thread.id || text.trim().length === 0}
                        onClick={() => void send(thread.id)}
                      >
                        {busy === thread.id ? tCommon('working') : t('sendReply')}
                      </button>
                    </div>
                    {saved.panel}
                    <p className="hint" id={`reply-window-${thread.id}`}>
                      {t('replyWindowOpen', { until: thread.reply.untilLabel })}
                    </p>
                  </div>
                ) : (
                  <p className="flex items-center gap-2 text-sm text-slate-600">
                    <Icon name="clock" size={16} className="shrink-0 text-slate-400" />
                    {thread.reply.state === 'closed' ? t('replyWindowClosed') : t('replyNobodyWaiting')}
                  </p>
                )}
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

/** A person's initial on a coloured disc; Graph does not give their photo. */
function Initial({ name }: { name: string }) {
  const palette = [
    'bg-sky-100 text-sky-700',
    'bg-violet-100 text-violet-700',
    'bg-emerald-100 text-emerald-700',
    'bg-amber-100 text-amber-800',
    'bg-rose-100 text-rose-700',
  ];
  const tone = palette[[...name].reduce((sum, char) => sum + char.charCodeAt(0), 0) % palette.length];
  return (
    <span
      aria-hidden
      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[15px] font-bold ${tone}`}
    >
      {name.trim().charAt(0).toUpperCase() || '?'}
    </span>
  );
}
