'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

import { Icon } from './Icon';

interface Entry {
  id: string;
  decision: string;
  comment: string | null;
  authorName: string;
  when: string;
}

const NAME_KEY = 'msp-share-name';

/**
 * Under each post on a review link: approve it, ask for changes, or comment,
 * signed with a name the browser remembers. What was said before shows above,
 * so a client coming back sees where things stand.
 */
export function ShareReview({
  token,
  postId,
  allowComments,
  history: initial,
}: {
  token: string;
  postId: string;
  allowComments: boolean;
  history: Entry[];
}) {
  const t = useTranslations('share');
  const [history, setHistory] = useState(initial);
  const [name, setName] = useState('');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      setName(window.localStorage.getItem(NAME_KEY) ?? '');
    } catch {
      // Storage may be off; the name is just typed again.
    }
  }, []);

  async function send(decision: 'approved' | 'rejected' | 'comment') {
    if (!name.trim()) {
      setError(t('nameFirst'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      window.localStorage.setItem(NAME_KEY, name.trim());
    } catch {
      // As above.
    }
    const response = await fetch(`/api/share/${token}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ postId, decision, comment: comment.trim() || null, authorName: name.trim() }),
    }).catch(() => null);
    setBusy(false);
    const body = (await response?.json().catch(() => ({}))) as { error?: string } | undefined;
    if (!response?.ok) {
      setError(body?.error ?? t('failed'));
      return;
    }
    setHistory((current) => [
      ...current,
      { id: String(Date.now()), decision, comment: comment.trim() || null, authorName: name.trim(), when: t('justNow') },
    ]);
    setComment('');
  }

  const last = [...history].reverse().find((entry) => entry.decision !== 'comment');

  return (
    <div className="-mt-1 rounded-b-xl border-x border-b border-slate-200 bg-white px-4 pb-4 pt-3">
      {history.length > 0 && (
        <ul className="mb-3 space-y-2">
          {history.map((entry) => (
            <li key={entry.id} className="flex items-start gap-2 text-sm">
              <span
                aria-hidden
                className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] text-white ${
                  entry.decision === 'approved' ? 'bg-emerald-500' : entry.decision === 'rejected' ? 'bg-rose-500' : 'bg-slate-400'
                }`}
              >
                {entry.decision === 'approved' ? '✓' : entry.decision === 'rejected' ? '!' : '…'}
              </span>
              <span className="min-w-0 flex-1 rounded-2xl bg-slate-100 px-3 py-1.5">
                <span className="block text-xs font-semibold text-slate-900">
                  {entry.authorName} · {t(`decision_${entry.decision}`)}
                  <span className="font-normal text-slate-500"> · {entry.when}</span>
                </span>
                {entry.comment && <span className="block whitespace-pre-wrap text-slate-800 [overflow-wrap:anywhere]">{entry.comment}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}

      {last && (
        <p className={`mb-3 text-xs font-semibold ${last.decision === 'approved' ? 'text-emerald-700' : 'text-rose-700'}`}>
          {last.decision === 'approved' ? t('statusApproved') : t('statusChanges')}
        </p>
      )}

      <div className="grid gap-2 sm:grid-cols-[10rem_1fr]">
        <input
          className="input py-1.5 text-sm"
          placeholder={t('yourName')}
          aria-label={t('yourName')}
          maxLength={80}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        {allowComments && (
          <textarea
            className="input min-h-[38px] resize-y py-1.5 text-sm"
            placeholder={t('commentPlaceholder')}
            aria-label={t('commentPlaceholder')}
            maxLength={2000}
            rows={1}
            value={comment}
            onChange={(event) => setComment(event.target.value)}
          />
        )}
      </div>
      {error && <p role="alert" className="mt-2 text-xs text-red-600">{error}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className="btn-primary bg-emerald-600 hover:bg-emerald-700" disabled={busy} onClick={() => void send('approved')}>
          <Icon name="check" size={16} />
          {t('approve')}
        </button>
        <button type="button" className="btn-secondary" disabled={busy} onClick={() => void send('rejected')}>
          {t('requestChanges')}
        </button>
        {allowComments && (
          <button type="button" className="btn-ghost" disabled={busy || !comment.trim()} onClick={() => void send('comment')}>
            <Icon name="comment" size={16} />
            {t('commentOnly')}
          </button>
        )}
      </div>
    </div>
  );
}
