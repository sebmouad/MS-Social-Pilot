'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

export interface ThreadView {
  id: string;
  participants: string;
  updatedLabel: string;
  messageCount: number;
  unreadCount: number;
  messages: Array<{ id: string; from: string; message: string | null }>;
  /** 'open' carries when Facebook's 24-hour window shuts, already formatted. */
  reply: { state: 'open'; untilLabel: string } | { state: 'closed' | 'no_recipient' };
}

/**
 * The Page inbox, with replies.
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
}: {
  threads: ThreadView[];
  canReply: boolean;
}) {
  const t = useTranslations('engagement');
  const tCommon = useTranslations('common');
  const router = useRouter();

  const [openThread, setOpenThread] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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

      setOpenThread(null);
      setText('');
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3">
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <ul className="space-y-3">
        {threads.map((thread) => (
          <li key={thread.id} className="card p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm font-medium text-slate-900">{thread.participants}</p>
              <p className="text-xs text-slate-500">
                {thread.updatedLabel} · {t('messageCount', { count: thread.messageCount })}
                {thread.unreadCount > 0 && ` · ${t('unread', { count: thread.unreadCount })}`}
              </p>
            </div>

            <ul className="mt-3 space-y-1.5">
              {[...thread.messages].reverse().map((message) => (
                <li key={message.id} className="text-sm">
                  <span className="font-medium text-slate-600">{message.from}: </span>
                  <span className="text-slate-700">{message.message ?? t('attachmentOnly')}</span>
                </li>
              ))}
            </ul>

            {canReply && (
              <div className="mt-3">
                {thread.reply.state === 'open' ? (
                  openThread === thread.id ? (
                    <div className="space-y-2">
                      <textarea
                        className="input min-h-[72px]"
                        value={text}
                        onChange={(event) => setText(event.target.value)}
                        placeholder={t('replyPlaceholder')}
                        maxLength={2000}
                      />
                      <p className="hint">
                        {t('replyWindowOpen', { until: thread.reply.untilLabel })}
                      </p>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          className="btn-primary"
                          disabled={busy === thread.id || text.trim().length === 0}
                          onClick={() => void send(thread.id)}
                        >
                          {busy === thread.id ? tCommon('working') : t('sendReply')}
                        </button>
                        <button
                          type="button"
                          className="btn-secondary"
                          disabled={busy === thread.id}
                          onClick={() => {
                            setOpenThread(null);
                            setText('');
                          }}
                        >
                          {tCommon('cancel')}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => {
                        setOpenThread(thread.id);
                        setText('');
                        setError(null);
                      }}
                    >
                      {t('reply')}
                    </button>
                  )
                ) : (
                  <p className="text-xs text-slate-500">
                    {thread.reply.state === 'closed'
                      ? t('replyWindowClosed')
                      : t('replyNobodyWaiting')}
                  </p>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
