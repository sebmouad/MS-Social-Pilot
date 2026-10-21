'use client';
import { useInboxCatalog } from './copy-context';

import { useState } from 'react';
import { ThreadProductivity } from '@/modules/inbox/components/ThreadProductivity';
import { ReplyBox } from './InboxActions';
import { useConfirm } from '@/components/useConfirm';
import type { InboxLocale } from './copy';



export function ThreadTools({ kind, id, canWrite, canReply, allowed, headline, detail, locale = 'en' }: { kind: 'message' | 'comment'; id: string; canWrite: boolean; canReply: boolean; allowed: boolean; headline: string; detail?: string; locale?: InboxLocale }) {
  const copy = useInboxCatalog('threadToolsCopy')[locale];
  const [draft, setDraft] = useState('');
  const [confirm, confirmDialog] = useConfirm({ title: copy.replaceTitle, cancel: copy.keep, confirm: copy.replace, danger: false });
  async function useSavedReply(body: string) {
    if (draft.trim() && !(await confirm(copy.replaceAsk))) return;
    setDraft(body);
  }
  return <>
    {confirmDialog}
    <ThreadProductivity kind={kind} id={id} canWrite={canWrite} locale={locale} onUseSavedReply={canWrite && canReply ? useSavedReply : undefined} />
    {canWrite && canReply
      ? <ReplyBox key={id} id={id} kind={kind} allowed={allowed} headline={headline} detail={detail} value={draft} onChange={setDraft} locale={locale} />
      : <p>{copy.readOnly}</p>}
  </>;
}
