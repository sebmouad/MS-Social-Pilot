'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

import { Icon } from './Icon';
import type { SpamRisk } from '@/lib/spam-guard';

export interface StaggerChoice {
  /** Minutes between Pages; 0 sends to every Page together. */
  minutes: number;
  aiVariants: boolean;
}

/**
 * Spam-risk guard, in the composer: asks the server whether
 * the post as it stands puts the same link or text on too many Pages at once,
 * says so with the numbers, and offers the fix — one Page at a time, and AI
 * rewording per Page. Never blocks: the person can send it as it is.
 */
export function SpamGuard({
  message,
  link,
  targetIds,
  scheduledAtLocal,
  timezone,
  postId,
  aiEnabled,
  canStagger,
  value,
  onChange,
}: {
  message: string;
  link: string;
  targetIds: string[];
  /** Null for "now" and the queue. */
  scheduledAtLocal: string | null;
  timezone: string;
  postId?: string;
  aiEnabled: boolean;
  /** False when editing: an existing post stays one post. */
  canStagger: boolean;
  value: StaggerChoice;
  onChange: (value: StaggerChoice) => void;
}) {
  const t = useTranslations('spamGuard');
  const [risk, setRisk] = useState<SpamRisk | null>(null);

  const targetKey = targetIds.join(',');
  useEffect(() => {
    if (targetIds.length === 0 || (!message.trim() && !link.trim())) {
      setRisk(null);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      const response = await fetch('/api/posts/spam-check', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          message,
          link: link.trim() || null,
          targetIds,
          scheduledAtLocal,
          timezone,
          postId,
        }),
        signal: controller.signal,
      }).catch(() => null);
      if (!response?.ok) return;
      const body = (await response.json().catch(() => ({}))) as { risk?: SpamRisk | null };
      setRisk(body.risk ?? null);
    }, 700);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // targetKey stands for targetIds, which is a new array on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message, link, targetKey, scheduledAtLocal, timezone, postId]);

  // Nothing to warn about any more: drop a stagger chosen for a warning that is gone.
  useEffect(() => {
    if (!risk && value.minutes > 0) onChange({ minutes: 0, aiVariants: false });
  }, [risk, value.minutes, onChange]);

  if (!risk) return null;

  const offer = canStagger && targetIds.length > 1;
  const spanMinutes = (targetIds.length - 1) * risk.gapMinutes;

  return (
    <div role="status" className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
      <p className="flex items-start gap-2 font-semibold">
        <Icon name="warning" size={16} className="mt-0.5 shrink-0" />
        {t('title', { pages: risk.pages, minutes: risk.gapMinutes })}
      </p>
      <p className="mt-1 text-xs">
        {risk.otherPosts > 0 ? t('bodyOthers', { posts: risk.otherPosts }) : t('body')}
      </p>
      {offer ? (
        <div className="mt-3 space-y-2">
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 rounded border-amber-300"
              checked={value.minutes > 0}
              onChange={(event) =>
                onChange({ minutes: event.target.checked ? risk.gapMinutes : 0, aiVariants: event.target.checked && value.aiVariants })
              }
            />
            <span>
              {t('stagger', { minutes: risk.gapMinutes })}
              <span className="block text-xs text-amber-800">{t('staggerHint', { minutes: spanMinutes, pages: targetIds.length })}</span>
            </span>
          </label>
          {aiEnabled && value.minutes > 0 && (
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 rounded border-amber-300"
                checked={value.aiVariants}
                onChange={(event) => onChange({ ...value, aiVariants: event.target.checked })}
              />
              <span>
                {t('aiVariants')}
                <span className="block text-xs text-amber-800">{t('aiVariantsHint')}</span>
              </span>
            </label>
          )}
        </div>
      ) : (
        <p className="mt-1 text-xs">{t('pickAnotherTime')}</p>
      )}
    </div>
  );
}
