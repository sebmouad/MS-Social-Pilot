'use client';

import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';

import { useConfirm } from './ConfirmProvider';
import { EmptyState } from './EmptyState';

type Match = 'links' | 'phones' | 'keywords';
type Action = 'hide' | 'alert' | 'reply';

export interface ModerationRuleView {
  id: string;
  name: string;
  enabled: boolean;
  /** Empty: every Facebook Page in the workspace, including ones added later. */
  targetIds: string[];
  match: Match;
  keywords: string[];
  action: Action;
  replyText: string | null;
  dailyCap: number;
  oncePerUser: boolean;
}

export interface ModerationLogView {
  id: string;
  when: string;
  page: string | null;
  rule: string;
  author: string | null;
  message: string;
  action: Action;
  error: string | null;
  undone: boolean;
}

interface Props {
  rules: ModerationRuleView[];
  pages: Array<{ id: string; name: string }>;
  log: ModerationLogView[];
  /** May this member write a rule for every Page? */
  allPages: boolean;
}

type Fields = Omit<ModerationRuleView, 'id'>;

const BLANK: Fields = {
  name: '',
  enabled: true,
  targetIds: [],
  match: 'links',
  keywords: [],
  action: 'hide',
  replyText: null,
  dailyCap: 20,
  oncePerUser: true,
};

export function ModerationRulesClient({ rules, pages, log, allPages }: Props) {
  const t = useTranslations('moderation');
  const tCommon = useTranslations('common');
  const confirm = useConfirm();
  const router = useRouter();

  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function call(path: string, init: RequestInit): Promise<boolean> {
    setError(null);
    setNotice(null);
    setPending(true);
    try {
      const response = await fetch(path, {
        ...init,
        headers: init.body ? { 'content-type': 'application/json' } : undefined,
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setError(body.error || tCommon('genericError'));
        return false;
      }
      router.refresh();
      return true;
    } catch {
      setError(tCommon('genericError'));
      return false;
    } finally {
      setPending(false);
    }
  }

  async function save(id: string | 'new', fields: Fields) {
    const done =
      id === 'new'
        ? await call('/api/moderation/rules', { method: 'POST', body: JSON.stringify(fields) })
        : await call(`/api/moderation/rules/${id}`, { method: 'PATCH', body: JSON.stringify(fields) });
    if (done) {
      setEditing(null);
      setNotice(t('saved'));
    }
  }

  const pageName = new Map(pages.map((page) => [page.id, page.name]));
  const pagesLabel = (rule: ModerationRuleView) =>
    rule.targetIds.length === 0
      ? t('allPages')
      : rule.targetIds.length === 1
        ? (pageName.get(rule.targetIds[0]!) ?? t('pageCount', { count: 1 }))
        : t('pageCount', { count: rule.targetIds.length });

  return (
    <div className="space-y-6">
      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {notice}
        </p>
      )}

      <section className="space-y-3" aria-labelledby="rules-heading">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="rules-heading" className="text-base font-semibold text-slate-900">
            {t('rulesHeading')}
          </h2>
          {editing === null && (
            <button type="button" className="btn-primary" onClick={() => setEditing('new')} disabled={pages.length === 0}>
              {t('addRule')}
            </button>
          )}
        </div>

        {editing === 'new' && (
          <RuleForm
            initial={{ ...BLANK, targetIds: allPages ? [] : pages.slice(0, 1).map((page) => page.id) }}
            pages={pages}
            allPages={allPages}
            pending={pending}
            onCancel={() => setEditing(null)}
            onSave={(fields) => save('new', fields)}
          />
        )}

        {rules.length === 0 && editing !== 'new' ? (
          <EmptyState
            icon="shield"
            title={t('emptyTitle')}
            hint={pages.length === 0 ? t('noPagesHint') : t('emptyHint')}
          />
        ) : (
          <ul className="space-y-3">
            {rules.map((rule) =>
              editing === rule.id ? (
                <li key={rule.id}>
                  <RuleForm
                    initial={rule}
                    pages={pages}
                    allPages={allPages}
                    pending={pending}
                    onCancel={() => setEditing(null)}
                    onSave={(fields) => save(rule.id, fields)}
                  />
                </li>
              ) : (
                <li key={rule.id} className="card flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-900">
                      {rule.name}
                      {!rule.enabled && (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">{t('paused')}</span>
                      )}
                    </p>
                    <p className="mt-1 text-sm text-slate-600">
                      {t('summary', {
                        match: t(`match.${rule.match}`),
                        action: t(`action.${rule.action}`),
                        pages: pagesLabel(rule),
                        cap: rule.dailyCap,
                      })}
                    </p>
                    {rule.match === 'keywords' && (
                      <p className="mt-1 break-words text-xs text-slate-500">{rule.keywords.join(', ')}</p>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="btn-secondary"
                      disabled={pending}
                      onClick={() =>
                        call(`/api/moderation/rules/${rule.id}`, {
                          method: 'PATCH',
                          body: JSON.stringify({ enabled: !rule.enabled }),
                        })
                      }
                    >
                      {rule.enabled ? t('pause') : t('resume')}
                    </button>
                    <button type="button" className="btn-secondary" disabled={pending || editing !== null} onClick={() => setEditing(rule.id)}>
                      {tCommon('edit')}
                    </button>
                    <button
                      type="button"
                      className="btn-ghost text-red-700"
                      disabled={pending}
                      onClick={async () => {
                        if (
                          await confirm({
                            title: t('deleteConfirm', { name: rule.name }),
                            body: t('deleteConfirmBody'),
                            danger: true,
                            confirmLabel: tCommon('delete'),
                          })
                        ) {
                          call(`/api/moderation/rules/${rule.id}`, { method: 'DELETE' });
                        }
                      }}
                    >
                      {tCommon('delete')}
                    </button>
                  </div>
                </li>
              ),
            )}
          </ul>
        )}
      </section>

      <section className="space-y-3" aria-labelledby="log-heading">
        <div>
          <h2 id="log-heading" className="text-base font-semibold text-slate-900">
            {t('logHeading')}
          </h2>
          <p className="mt-1 text-sm text-slate-600">{t('logHint')}</p>
        </div>
        {log.length === 0 ? (
          <EmptyState icon="clock" title={t('logEmptyTitle')} hint={t('logEmptyHint')} />
        ) : (
          <ul className="space-y-2" aria-label={t('logHeading')}>
            {log.map((entry) => (
              <li key={entry.id} className="card flex flex-col gap-2 p-4 sm:flex-row sm:items-start">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-700">{t(`done.${entry.action}`)}</span>
                    {entry.page && <span className="font-medium text-slate-700">{entry.page}</span>}
                    <span>{entry.when}</span>
                    <span>{t('byRule', { rule: entry.rule })}</span>
                    {entry.undone && <span className="rounded-full bg-amber-50 px-2 py-0.5 font-medium text-amber-800">{t('undone')}</span>}
                  </p>
                  <p className="mt-1 text-sm font-semibold text-slate-900">{entry.author || t('someone')}</p>
                  <p className="mt-0.5 line-clamp-3 whitespace-pre-line break-words text-sm text-slate-800">{entry.message}</p>
                  {entry.error && <p className="mt-1 text-sm text-red-700">{t('failed', { reason: entry.error })}</p>}
                </div>
                {entry.action !== 'alert' && !entry.error && !entry.undone && (
                  <button
                    type="button"
                    className="btn-secondary self-start"
                    disabled={pending}
                    onClick={async () => {
                      if (
                        await confirm({
                          title: entry.action === 'hide' ? t('undoHideConfirm') : t('undoReplyConfirm'),
                          body: entry.action === 'hide' ? t('undoHideBody') : t('undoReplyBody'),
                          confirmLabel: entry.action === 'hide' ? t('undoHide') : t('undoReply'),
                        })
                      ) {
                        if (await call(`/api/moderation/actions/${entry.id}/undo`, { method: 'POST' })) setNotice(t('undoneOk'));
                      }
                    }}
                  >
                    {entry.action === 'hide' ? t('undoHide') : t('undoReply')}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function RuleForm({
  initial,
  pages,
  allPages,
  pending,
  onCancel,
  onSave,
}: {
  initial: Fields;
  pages: Array<{ id: string; name: string }>;
  allPages: boolean;
  pending: boolean;
  onCancel: () => void;
  onSave: (fields: Fields) => void;
}) {
  const t = useTranslations('moderation');
  const tCommon = useTranslations('common');
  const id = useId();
  const [fields, setFields] = useState<Fields>(initial);
  const [keywords, setKeywords] = useState(initial.keywords.join(', '));
  const set = (patch: Partial<Fields>) => setFields((current) => ({ ...current, ...patch }));
  const everyPage = fields.targetIds.length === 0;

  return (
    <form
      className="card space-y-4 p-4"
      aria-label={t('formLabel')}
      onSubmit={(event) => {
        event.preventDefault();
        onSave({
          ...fields,
          keywords: fields.match === 'keywords' ? keywords.split(/[,\n]/).map((word) => word.trim()).filter(Boolean) : [],
          replyText: fields.action === 'reply' ? fields.replyText : null,
        });
      }}
    >
      <div>
        <label className="label" htmlFor={`${id}-name`}>
          {t('name')}
        </label>
        <input
          id={`${id}-name`}
          className="input"
          required
          maxLength={120}
          value={fields.name}
          placeholder={t('namePlaceholder')}
          onChange={(event) => set({ name: event.target.value })}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor={`${id}-match`}>
            {t('when')}
          </label>
          <select id={`${id}-match`} className="input" value={fields.match} onChange={(event) => set({ match: event.target.value as Match })}>
            {(['links', 'phones', 'keywords'] as const).map((match) => (
              <option key={match} value={match}>
                {t(`match.${match}`)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor={`${id}-action`}>
            {t('then')}
          </label>
          <select id={`${id}-action`} className="input" value={fields.action} onChange={(event) => set({ action: event.target.value as Action })}>
            {(['hide', 'alert', 'reply'] as const).map((action) => (
              <option key={action} value={action}>
                {t(`action.${action}`)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {fields.match === 'keywords' && (
        <div>
          <label className="label" htmlFor={`${id}-keywords`}>
            {t('keywords')}
          </label>
          <textarea
            id={`${id}-keywords`}
            className="input"
            rows={2}
            required
            value={keywords}
            placeholder={t('keywordsPlaceholder')}
            onChange={(event) => setKeywords(event.target.value)}
          />
          <p className="mt-1 text-xs text-slate-500">{t('keywordsHint')}</p>
        </div>
      )}

      {fields.action === 'reply' && (
        <div>
          <label className="label" htmlFor={`${id}-reply`}>
            {t('replyText')}
          </label>
          <textarea
            id={`${id}-reply`}
            className="input"
            rows={3}
            required
            maxLength={2000}
            value={fields.replyText ?? ''}
            onChange={(event) => set({ replyText: event.target.value })}
          />
          <p className="mt-1 text-xs text-slate-500">{t('replyHint')}</p>
          <label className="mt-2 flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={fields.oncePerUser} onChange={(event) => set({ oncePerUser: event.target.checked })} />
            {t('oncePerUser')}
          </label>
        </div>
      )}

      <fieldset>
        <legend className="label">{t('pages')}</legend>
        <div className="mt-1 space-y-1">
          {allPages && (
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={everyPage}
                onChange={(event) => set({ targetIds: event.target.checked ? [] : pages.slice(0, 1).map((page) => page.id) })}
              />
              {t('allPagesOption')}
            </label>
          )}
          {!everyPage &&
            pages.map((page) => (
              <label key={page.id} className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={fields.targetIds.includes(page.id)}
                  onChange={(event) =>
                    set({
                      targetIds: event.target.checked
                        ? [...fields.targetIds, page.id]
                        : fields.targetIds.filter((targetId) => targetId !== page.id),
                    })
                  }
                />
                {page.name}
              </label>
            ))}
        </div>
      </fieldset>

      <div className="max-w-xs">
        <label className="label" htmlFor={`${id}-cap`}>
          {t('dailyCap')}
        </label>
        <input
          id={`${id}-cap`}
          className="input"
          type="number"
          min={1}
          max={500}
          required
          value={fields.dailyCap}
          onChange={(event) => set({ dailyCap: Number(event.target.value) })}
        />
        <p className="mt-1 text-xs text-slate-500">{t('dailyCapHint')}</p>
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="submit" className="btn-primary" disabled={pending || (!everyPage && fields.targetIds.length === 0)}>
          {t('saveRule')}
        </button>
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={pending}>
          {tCommon('cancel')}
        </button>
      </div>
    </form>
  );
}
