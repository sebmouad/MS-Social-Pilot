'use client';
import { useInboxCatalog } from './copy-context';

import { useState } from 'react';
import { ThreadProductivity } from '@/modules/inbox/components/ThreadProductivity';
import { ReplyBox } from './InboxActions';
import { useConfirm } from '@/components/useConfirm';
import type { InboxLocale } from './copy';



type ThreadToolsProps = { kind: 'message' | 'comment'; id: string; canWrite: boolean; canReply: boolean; allowed: boolean; headline: string; detail?: string; locale?: InboxLocale };

export function ThreadTools(props: ThreadToolsProps) {
  return <ThreadToolsState key={`${props.kind}:${props.id}`} {...props} />;
}

function ThreadToolsState({ kind, id, canWrite, canReply, allowed, headline, detail, locale = 'en' }: ThreadToolsProps) {
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
      ? <ReplyBox key={id} id={id} kind={kind} allowed={allowed} headline={headline} detail={detail} value={draft} onChange={setDraft} onInsertSavedReply={useSavedReply} locale={locale} />
      : <p>{copy.readOnly}</p>}
  </>;
}
