'use client';

import { useEffect, useRef, useState } from 'react';
import { DataTable, type TableColumn } from '@/components/DataTable';
import type { PlatformPublicationEvidence } from '@/server/platforms/host';
import { RootPlatformPublicationAction } from './RootPlatformPublicationAction';

type Props = { evidence: PlatformPublicationEvidence; providerId: string; filtered: boolean; scopeKey?: string };

export function RootPlatformPublicationTable({ evidence, providerId, filtered, scopeKey }: Props) {
  const noticeScope = scopeKey ?? `${providerId}:${filtered}`;
  const [notice, setNotice] = useState<{ message: string; scope: string; sequence: number } | null>(null);
  const visibleNotice = notice?.scope === noticeScope ? notice : null;
  const announce = (message: string) => setNotice(previous => ({ message, scope: noticeScope, sequence: (previous?.sequence ?? 0) + 1 }));
  const noticeRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (notice?.scope === noticeScope) noticeRef.current?.focus(); }, [notice, noticeScope]);

  const summaryKeys = evidence.summaryColumnKeys;
  const summaryKeysValid = Array.isArray(summaryKeys) && summaryKeys.length > 0 &&
    summaryKeys.length <= evidence.columns.length && new Set(summaryKeys).size === summaryKeys.length &&
    summaryKeys.every(key => evidence.columns.some(column => column.key === key));
  const summaryColumns = summaryKeysValid
    ? summaryKeys.map(key => evidence.columns.find(column => column.key === key)!)
    : null;
  const visibleColumns = summaryColumns ?? evidence.columns;
  const columns: TableColumn<PlatformPublicationEvidence['items'][number]>[] = visibleColumns.map(column => ({
    key: column.key,
    label: column.label,
    render: row => {
      const value = row[column.key];
      return value === null || value === undefined ? '—' : typeof value === 'number' ? value : <span className="root-publication-evidence__cell">{value}</span>;
    },
  }));
  if (summaryColumns) columns.push({
    key: '__rootReceiptDetails',
    label: 'Details',
    render: row => <details className="root-publication-evidence__details">
      <summary aria-label={evidence.rowIdKey && typeof row[evidence.rowIdKey] === 'string' ? `View receipt details for ${row[evidence.rowIdKey]}` : undefined}>View receipt details</summary>
      <dl>
        {evidence.columns.map(column => {
          const value = row[column.key];
          return <div key={column.key}>
            <dt>{column.label}</dt>
            <dd><span className="root-publication-evidence__details-value">{value === null || value === undefined ? '—' : String(value)}</span></dd>
          </div>;
        })}
      </dl>
    </details>,
  });
  if (evidence.rowIdKey && evidence.actions?.length) columns.push({
    key: '__rootModuleActions',
    label: 'Actions',
    render: row => {
      const rowId = row[evidence.rowIdKey!];
      if (typeof rowId !== 'string') return '—';
      const actions = evidence.actions!.filter(action => action.rowId === rowId);
      return actions.length ? <div className="root-publication-evidence__actions">{actions.map((action, index) => <RootPlatformPublicationAction key={`${action.actionId}-${action.subjectId}-${index}`} providerId={providerId} action={action} onReceipt={announce} />)}</div> : '—';
    },
  });

  const rowIdKey = evidence.rowIdKey;
  return <section className="root-jobs" aria-labelledby={`root-platform-publication-evidence-${providerId}`}>
    <p className="root-jobs__eyebrow">Platform operations</p>
    <h2 id={`root-platform-publication-evidence-${providerId}`}>{evidence.title}</h2>
    <p>{evidence.description}</p>
    <p>Evidence is bounded to operation and receipt details. Any available action requires its own module-defined confirmation and acknowledgment.</p>
    {visibleNotice ? <p key={visibleNotice.sequence} ref={noticeRef} className="root-control__notice" role="status" tabIndex={-1}>{visibleNotice.message}</p> : null}
    <div className="root-publication-evidence__table">
      <DataTable rows={evidence.items} columns={columns} rowKey={row => {
        const id = rowIdKey ? row[rowIdKey] : null;
        return `${providerId}-${typeof id === 'string' ? id : JSON.stringify(row)}`;
      }} caption={evidence.title} emptyMessage={filtered ? 'No publication evidence is recorded for this operation.' : 'No publication evidence is recorded for this platform.'} />
    </div>
    {evidence.truncated ? <p role="status">This history is truncated by the platform evidence limit. Use the Platform evidence sidebar filter to narrow the results. Configured limits still apply to a single operation.</p> : null}
  </section>;
}
