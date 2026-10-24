'use client';
import { useInboxCatalog } from './copy-context';

import { useEffect, useState } from 'react';
import { ReplyBox } from './InboxActions';

/** Each stored visitor reply retains its own draft and addresses its own ID. */
export function NestedReply({ id, author, canReply, allowed }: { id: string; author: string; canReply: boolean; allowed: boolean }) {
  const [locale, setLocale] = useState<'en' | 'fr'>('en');
  useEffect(() => { setLocale(document.documentElement.lang.startsWith('fr') ? 'fr' : 'en'); }, []);
  const copy = useInboxCatalog('REPLY_COPY')[locale];
  if (!canReply) return null;
  return <details>
    <summary>{copy.to(author)}</summary>
    <ReplyBox id={id} kind="comment" allowed={allowed} headline={allowed ? copy.public : copy.unavailable} locale={locale} />
  </details>;
}
