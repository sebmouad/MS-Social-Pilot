'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useTranslations } from 'next-intl';

import { EmptyState } from './EmptyState';
import { useConfirm } from './ConfirmProvider';

interface AgentRow {
  id: string;
  targetId: string;
  brief: string;
  weekday: number;
  count: number;
  enabled: boolean;
}

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;

/** Standing briefs: each writes a week of drafts for one Page on its day. */
export function AgentsClient({ agents, pages, available }: { agents: AgentRow[]; pages: Array<{ id: string; name: string }>; available: boolean }) {
  const t = useTranslations('agents');
  const router = useRouter();
  const confirm = useConfirm();
  const [targetId, setTargetId] = useState(pages[0]?.id ?? '');
  const [brief, setBrief] = useState('');
  const [weekday, setWeekday] = useState(1);
  const [count, setCount] = useState(5);
  const [error, setError] = useState(false);
  const names = new Map(pages.map((page) => [page.id, page.name]));

  async function call(path: string, method: string, body?: unknown) {
    setError(false);
    const response = await fetch(path, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).catch(() => null);
    if (!response?.ok) {
      setError(true);
      return false;
    }
    router.refresh();
    return true;
  }

  async function add() {
    if (await call('/api/ai-agents', 'POST', { targetId, brief, weekday, count })) setBrief('');
  }

  async function remove(id: string) {
    if (await confirm({ title: t('deleteTitle'), body: t('deleteBody'), confirmLabel: t('delete'), danger: true })) await call(`/api/ai-agents/${id}`, 'DELETE');
  }

  return (
    <div className="space-y-4">
      {!available && <p className="card p-3 text-sm text-gray-600">{t('unavailable')}</p>}
      {pages.length > 0 && (
        <form
          className="card space-y-2 p-3"
          onSubmit={(event) => {
            event.preventDefault();
            void add();
          }}
        >
          <textarea className="input w-full" rows={2} maxLength={2000} placeholder={t('briefPlaceholder')} aria-label={t('brief')} value={brief} onChange={(event) => setBrief(event.target.value)} />
          <div className="flex flex-wrap items-end gap-2">
            <select className="input" aria-label={t('page')} value={targetId} onChange={(event) => setTargetId(event.target.value)}>
              {pages.map((page) => (
                <option key={page.id} value={page.id}>
                  {page.name}
                </option>
              ))}
            </select>
            <select className="input" aria-label={t('day')} value={weekday} onChange={(event) => setWeekday(Number(event.target.value))}>
              {WEEKDAYS.map((name, index) => (
                <option key={name} value={index}>
                  {t(`days.${name}`)}
                </option>
              ))}
            </select>
            <input className="input w-20" type="number" min={1} max={14} aria-label={t('count')} value={count} onChange={(event) => setCount(Number(event.target.value) || 1)} />
            <button className="btn btn-primary" type="submit" disabled={brief.trim().length < 3 || !targetId}>
              {t('add')}
            </button>
          </div>
          {error && <p className="text-sm text-red-600">{t('failed')}</p>}
        </form>
      )}
      {agents.length === 0 ? (
        <EmptyState title={t('empty')} />
      ) : (
        <ul className="space-y-2">
          {agents.map((agent) => (
            <li key={agent.id} className="card flex flex-wrap items-center gap-3 p-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{t('summary', { count: agent.count, page: names.get(agent.targetId) ?? '', day: t(`days.${WEEKDAYS[agent.weekday]}`) })}</p>
                <p className="truncate text-sm text-gray-600">{agent.brief}</p>
              </div>
              <label className="flex items-center gap-1 text-sm">
                <input type="checkbox" checked={agent.enabled} onChange={(event) => void call(`/api/ai-agents/${agent.id}`, 'PATCH', { enabled: event.target.checked })} />
                {t('on')}
              </label>
              <button className="btn" type="button" onClick={() => void remove(agent.id)}>
                {t('delete')}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
