'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useTranslations } from 'next-intl';

import { LabelChips } from './LabelChips';

interface Option {
  id: string;
  name: string;
}

interface LabelOption extends Option {
  color: string;
}

interface Rule {
  targetId: string | null;
  groupId: string | null;
  labelId: string;
  perWeek: number;
}

interface MixLine {
  labelId: string;
  perWeek: number;
  planned: number;
  drafts: number;
}

/** Mirrors `MAX_PER_WEEK` in src/lib/content-mix.ts (a server module). */
const MAX_PER_WEEK = 50;

/**
 * Content mix (NEXT_PHASES H1): the coming week per Page against its mix,
 * and, for admins, the mix of a Page or group and the auto-fill switch.
 */
export function ContentMixClient({
  canEdit,
  autoFill: initialAutoFill,
  pages,
  groups,
  labels,
  rules,
  status,
}: {
  canEdit: boolean;
  autoFill: boolean;
  pages: Option[];
  groups: Option[];
  labels: LabelOption[];
  rules: Rule[];
  status: Array<{ targetId: string; lines: MixLine[] }>;
}) {
  const t = useTranslations('mix');
  const router = useRouter();
  const labelOf = new Map(labels.map((label) => [label.id, label]));
  const pageName = new Map(pages.map((page) => [page.id, page.name]));

  const [scope, setScope] = useState(() => (pages[0] ? `page:${pages[0].id}` : groups[0] ? `group:${groups[0].id}` : ''));
  const rulesFor = (key: string) => {
    const [kind, id] = key.split(':');
    return rules
      .filter((rule) => (kind === 'page' ? rule.targetId === id : rule.groupId === id))
      .map((rule) => ({ labelId: rule.labelId, perWeek: rule.perWeek }));
  };
  const [draft, setDraft] = useState(() => rulesFor(scope));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [autoFill, setAutoFill] = useState(initialAutoFill);

  function pick(key: string) {
    setScope(key);
    setDraft(rulesFor(key));
    setMessage(null);
  }

  async function save() {
    const [kind, id] = scope.split(':');
    setSaving(true);
    setMessage(null);
    const response = await fetch('/api/content-mix', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scope: kind === 'page' ? { targetId: id } : { groupId: id }, rules: draft }),
    }).catch(() => null);
    const body = (await response?.json().catch(() => ({}))) as { error?: string } | undefined;
    setSaving(false);
    setMessage(response?.ok ? { ok: true, text: t('saved') } : { ok: false, text: body?.error ?? t('saveFailed') });
    if (response?.ok) router.refresh();
  }

  async function toggleAutoFill(next: boolean) {
    setAutoFill(next);
    const response = await fetch('/api/content-mix', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ autoFill: next }),
    }).catch(() => null);
    if (!response?.ok) setAutoFill(!next);
  }

  const unused = labels.filter((label) => !draft.some((rule) => rule.labelId === label.id));
  const scopeHasGroupRulesOnly = scope.startsWith('page:') && draft.length === 0;

  return (
    <div className="space-y-6">
      <section className="card p-4 sm:p-5" aria-labelledby="mix-week">
        <h2 id="mix-week" className="text-base font-semibold text-slate-900">
          {t('weekTitle')}
        </h2>
        <p className="hint">{autoFill ? t('weekHintAuto') : t('weekHint')}</p>
        {status.length === 0 ? (
          <p className="mt-3 text-sm text-slate-600">{canEdit ? t('noneAdmin') : t('none')}</p>
        ) : (
          <div className="scroll-x mt-3">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-start text-xs uppercase tracking-wide text-slate-500">
                  <th className="py-2 pe-3 text-start font-semibold">{t('page')}</th>
                  <th className="py-2 pe-3 text-start font-semibold">{t('label')}</th>
                  <th className="py-2 pe-3 text-end font-semibold">{t('planned')}</th>
                  <th className="py-2 pe-3 text-end font-semibold">{t('drafts')}</th>
                  <th className="py-2 text-start font-semibold">{t('state')}</th>
                </tr>
              </thead>
              <tbody>
                {status.flatMap((page) =>
                  page.lines.map((line, index) => {
                    const label = labelOf.get(line.labelId);
                    const short = Math.max(0, line.perWeek - line.planned);
                    return (
                      <tr key={`${page.targetId}-${line.labelId}`} className="border-b border-slate-100 last:border-0">
                        <td className="py-2 pe-3 font-medium text-slate-800">{index === 0 ? pageName.get(page.targetId) : ''}</td>
                        <td className="py-2 pe-3">{label && <LabelChips labels={[label]} />}</td>
                        <td className="nums py-2 pe-3 text-end">{t('plannedOf', { planned: line.planned, target: line.perWeek })}</td>
                        <td className="nums py-2 pe-3 text-end">{line.drafts}</td>
                        <td className="py-2">
                          {short === 0 ? (
                            <span className="badge bg-emerald-50 text-emerald-800">{t('onTrack')}</span>
                          ) : line.drafts === 0 ? (
                            <span className="badge bg-red-50 text-red-800">{t('dry', { count: short })}</span>
                          ) : (
                            <span className="badge bg-amber-50 text-amber-900">{t('short', { count: short })}</span>
                          )}
                        </td>
                      </tr>
                    );
                  }),
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {canEdit && (
        <section className="card space-y-4 p-4 sm:p-5" aria-labelledby="mix-edit">
          <div>
            <h2 id="mix-edit" className="text-base font-semibold text-slate-900">
              {t('editTitle')}
            </h2>
            <p className="hint">{t('editHint')}</p>
          </div>

          {labels.length === 0 ? (
            <p className="text-sm text-slate-600">
              {t('noLabels')}{' '}
              <Link href="/compose" className="font-medium text-brand-600 hover:underline">
                {t('noLabelsAction')}
              </Link>
            </p>
          ) : pages.length + groups.length === 0 ? (
            <p className="text-sm text-slate-600">{t('noPages')}</p>
          ) : (
            <>
              <div>
                <label className="label" htmlFor="mix-scope">
                  {t('scope')}
                </label>
                <select id="mix-scope" className="input max-w-sm" value={scope} onChange={(event) => pick(event.target.value)}>
                  {pages.length > 0 && (
                    <optgroup label={t('pages')}>
                      {pages.map((page) => (
                        <option key={page.id} value={`page:${page.id}`}>
                          {page.name}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {groups.length > 0 && (
                    <optgroup label={t('groups')}>
                      {groups.map((group) => (
                        <option key={group.id} value={`group:${group.id}`}>
                          {group.name}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
                {scopeHasGroupRulesOnly && <p className="hint">{t('pageFollowsGroups')}</p>}
              </div>

              {draft.length > 0 && (
                <ul className="space-y-2">
                  {draft.map((rule, index) => (
                    <li key={rule.labelId} className="flex flex-wrap items-center gap-2">
                      <select
                        className="input w-auto min-w-40"
                        aria-label={t('label')}
                        value={rule.labelId}
                        onChange={(event) =>
                          setDraft((current) => current.map((entry, at) => (at === index ? { ...entry, labelId: event.target.value } : entry)))
                        }
                      >
                        {[labelOf.get(rule.labelId), ...unused].filter(Boolean).map((label) => (
                          <option key={label!.id} value={label!.id}>
                            {label!.name}
                          </option>
                        ))}
                      </select>
                      <input
                        type="number"
                        className="input w-24"
                        min={1}
                        max={MAX_PER_WEEK}
                        aria-label={t('perWeekLabel', { label: labelOf.get(rule.labelId)?.name ?? '' })}
                        value={rule.perWeek}
                        onChange={(event) => {
                          const value = Math.min(MAX_PER_WEEK, Math.max(1, Number(event.target.value) || 1));
                          setDraft((current) => current.map((entry, at) => (at === index ? { ...entry, perWeek: value } : entry)));
                        }}
                      />
                      <span className="text-sm text-slate-600">{t('perWeek')}</span>
                      <button
                        type="button"
                        className="btn-ghost text-sm"
                        onClick={() => setDraft((current) => current.filter((_, at) => at !== index))}
                      >
                        {t('remove')}
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={unused.length === 0}
                  onClick={() => setDraft((current) => [...current, { labelId: unused[0]!.id, perWeek: 1 }])}
                >
                  {t('addLabel')}
                </button>
                <button type="button" className="btn-primary" disabled={saving || !scope} onClick={save}>
                  {saving ? t('saving') : t('save')}
                </button>
                {message && (
                  <p role="status" className={`text-sm ${message.ok ? 'text-emerald-700' : 'text-red-700'}`}>
                    {message.text}
                  </p>
                )}
              </div>
            </>
          )}

          <label className="flex items-start gap-2 border-t border-slate-100 pt-4 text-sm text-slate-700">
            <input type="checkbox" className="mt-0.5" checked={autoFill} onChange={(event) => toggleAutoFill(event.target.checked)} />
            <span>
              <span className="font-medium text-slate-900">{t('autoFill')}</span>
              <span className="block text-slate-600">{t('autoFillHint')}</span>
            </span>
          </label>
        </section>
      )}
    </div>
  );
}
