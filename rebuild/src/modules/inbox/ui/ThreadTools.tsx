'use client';

import { useState } from 'react';
import { ThreadProductivity } from '@/modules/inbox/components/ThreadProductivity';
import { ReplyBox } from './InboxActions';
import { useConfirm } from '@/components/useConfirm';
import type { InboxLocale } from './copy';

const COPY = {
  en: { replaceTitle: 'Replace your draft?', keep: 'Keep draft', replace: 'Replace', replaceAsk: 'Replace the current reply draft with this saved reply?', readOnly: 'You can read this conversation, but replying is unavailable for your role or this channel.' },
  fr: { replaceTitle: 'Remplacer votre brouillon ?', keep: 'Garder le brouillon', replace: 'Remplacer', replaceAsk: 'Remplacer le brouillon de réponse actuel par cette réponse enregistrée ?', readOnly: 'Vous pouvez lire cette conversation, mais répondre n’est pas possible avec votre rôle ou pour ce canal.' },
} as const;

export function ThreadTools({ kind, id, canWrite, canReply, allowed, headline, detail, locale = 'en' }: { kind: 'message' | 'comment'; id: string; canWrite: boolean; canReply: boolean; allowed: boolean; headline: string; detail?: string; locale?: InboxLocale }) {
  const copy = COPY[locale];
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
