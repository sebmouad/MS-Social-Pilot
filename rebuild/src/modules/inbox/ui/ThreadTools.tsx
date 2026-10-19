'use client';

import { useState } from 'react';
import { ThreadProductivity } from '@/modules/inbox/components/ThreadProductivity';
import { ReplyBox } from './InboxActions';
import { useConfirm } from '@/components/useConfirm';

export function ThreadTools({ kind, id, canWrite, canReply, allowed, headline, detail }: { kind: 'message' | 'comment'; id: string; canWrite: boolean; canReply: boolean; allowed: boolean; headline: string; detail?: string }) {
  const [draft, setDraft] = useState('');
  const [confirm, confirmDialog] = useConfirm({ title: 'Replace your draft?', cancel: 'Keep draft', confirm: 'Replace', danger: false });
  async function useSavedReply(body: string) {
    if (draft.trim() && !(await confirm('Replace the current reply draft with this saved reply?'))) return;
    setDraft(body);
  }
  return <>
    {confirmDialog}
    <ThreadProductivity kind={kind} id={id} canWrite={canWrite} onUseSavedReply={canWrite && canReply ? useSavedReply : undefined} />
    {canWrite && canReply
      ? <ReplyBox key={id} id={id} kind={kind} allowed={allowed} headline={headline} detail={detail} value={draft} onChange={setDraft} />
      : <p>You can read this conversation, but replying is unavailable for your role or this channel.</p>}
  </>;
}
