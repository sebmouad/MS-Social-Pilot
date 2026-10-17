'use client';

import { useEffect, useRef, useState } from 'react';
import { DataTable, type TableColumn } from '@/components/DataTable';
import type { PlatformPublicationEvidence } from '@/server/platforms/host';
import { RootPlatformPublicationAction } from './RootPlatformPublicationAction';

type Props = { evidence: PlatformPublicationEvidence; providerId: string; filtered: boolean };

export function RootPlatformPublicationTable({ evidence, providerId, filtered }: Props) {
  const [notice, setNotice] = useState<string | null>(null);
  const noticeRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (notice) noticeRef.current?.focus(); }, [notice]);

  const columns: TableColumn<PlatformPublicationEvidence['items'][number]>[] = evidence.columns.map(column => ({
    key: column.key,
    label: column.label,
    render: row => {
      const value = row[column.key];
      return value === null || value === undefined ? '—' : typeof value === 'number' ? value : <span className="root-publication-evidence__cell">{value}</span>;
    },
  }));
  if (evidence.rowIdKey && evidence.actions?.length) columns.push({
    key: 'moduleActions',
    label: 'Actions',
    render: row => {
      const rowId = row[evidence.rowIdKey!];
      if (typeof rowId !== 'string') return '—';
      const actions = evidence.actions!.filter(action => action.rowId === rowId);
      return actions.length ? <div className="root-publication-evidence__actions">{actions.map((action, index) => <RootPlatformPublicationAction key={`${action.actionId}-${action.subjectId}-${index}`} providerId={providerId} action={action} onReceipt={setNotice} />)}</div> : '—';
    },
  });

  const rowIdKey = evidence.rowIdKey;
  return <section className="root-jobs" aria-labelledby={`root-platform-publication-evidence-${providerId}`}>
    <p className="root-jobs__eyebrow">Platform operations</p>
    <h2 id={`root-platform-publication-evidence-${providerId}`}>{evidence.title}</h2>
    <p>{evidence.description}</p>
    <p>Evidence is bounded to operation and receipt details. Any available action requires its own module-defined confirmation and acknowledgment.</p>
    {notice ? <p ref={noticeRef} className="root-control__notice" role="status" tabIndex={-1}>{notice}</p> : null}
    <DataTable rows={evidence.items} columns={columns} rowKey={row => {
      const id = rowIdKey ? row[rowIdKey] : null;
      return `${providerId}-${typeof id === 'string' ? id : JSON.stringify(row)}`;
    }} caption={evidence.title} emptyMessage={filtered ? 'No publication evidence is recorded for this operation.' : 'No publication evidence is recorded for this platform.'} />
    {evidence.truncated ? <p role="status">This history is truncated by the platform evidence limit. Use the Platform evidence sidebar filter to narrow the results. Configured limits still apply to a single operation.</p> : null}
  </section>;
}
