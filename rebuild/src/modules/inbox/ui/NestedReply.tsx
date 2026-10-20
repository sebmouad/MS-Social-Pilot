'use client';

import { useEffect, useState } from 'react';
import { ReplyBox } from './InboxActions';
import { REPLY_COPY } from './reply-copy';

/** Each stored visitor reply retains its own draft and addresses its own ID. */
export function NestedReply({ id, author, canReply, allowed }: { id: string; author: string; canReply: boolean; allowed: boolean }) {
  const [locale, setLocale] = useState<'en' | 'fr'>('en');
  useEffect(() => { setLocale(document.documentElement.lang.startsWith('fr') ? 'fr' : 'en'); }, []);
  if (!canReply) return null;
  const copy = REPLY_COPY[locale];
  return <details>
    <summary>{copy.to(author)}</summary>
    <ReplyBox id={id} kind="comment" allowed={allowed} headline={allowed ? copy.public : copy.unavailable} locale={locale} />
  </details>;
}
