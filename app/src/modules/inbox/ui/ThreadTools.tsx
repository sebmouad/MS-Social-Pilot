'use client';
import { useInboxCatalog } from './copy-context';

import { useState } from 'react';
import { ThreadProductivity } from '@/modules/inbox/components/ThreadProductivity';
import { ReplyBox } from './InboxActions';
import { useConfirm } from '@/components/useConfirm';
import type { InboxLocale } from './copy';
import styles from './inbox.module.css';



type ThreadToolsProps = { kind: 'message' | 'comment'; id: string; canWrite: boolean; canReply: boolean; allowed: boolean; headline: string; detail?: string; locale?: InboxLocale; source?: string; aiAvailable?: boolean };

export function ThreadTools(props: ThreadToolsProps) {
  return <ThreadToolsState key={`${props.kind}:${props.id}`} {...props} />;
}

function ThreadToolsState({ kind, id, canWrite, canReply, allowed, headline, detail, locale = 'en', source, aiAvailable }: ThreadToolsProps) {
  const copy = useInboxCatalog('threadToolsCopy')[locale];
  const teamCopy = useInboxCatalog('productivityCopy')[locale];
  const [draft, setDraft] = useState('');
  const [confirm, confirmDialog] = useConfirm({ title: copy.replaceTitle, cancel: copy.keep, confirm: copy.replace, danger: false });
  async function useSavedReply(body: string) {
    if (draft.trim() && !(await confirm(copy.replaceAsk))) return;
    setDraft(body);
  }
  return <>
    {confirmDialog}
    {canWrite && canReply
      ? <ReplyBox key={id} id={id} kind={kind} allowed={allowed} headline={headline} detail={detail} value={draft} onChange={setDraft} onInsertSavedReply={useSavedReply} source={source} aiAvailable={aiAvailable} locale={locale} />
      : <p>{copy.readOnly}</p>}
    {/* Team-only tools follow the reply, folded, so the conversation and the reply box stay together on a phone. */}
    <details className={styles.teamTools}>
      <summary>{teamCopy.teamSection}</summary>
      <ThreadProductivity kind={kind} id={id} canWrite={canWrite} locale={locale} />
    </details>
  </>;
}
