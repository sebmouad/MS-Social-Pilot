'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';

import { Dialog } from './Dialog';
import { EmptyState } from './EmptyState';
import { FeedAvatar } from './FeedPost';
import { Icon } from './Icon';
import { PALETTE_KEYS, paletteOf, type PaletteKey } from '@/lib/palette';

interface Page {
  id: string;
  name: string;
  pictureUrl: string | null;
  type: string;
  category: string | null;
}

interface Group {
  id: string;
  name: string;
  color: PaletteKey;
  targetIds: string[];
}

interface Label {
  id: string;
  name: string;
  color: PaletteKey;
  posts: number;
}

type Editing = { kind: 'group'; id: string | null; name: string; color: PaletteKey; targetIds: string[] };

export function GroupsAndLabels({
  canManageGroups,
  canManageLabels,
  pages,
  groups,
  labels,
}: {
  canManageGroups: boolean;
  canManageLabels: boolean;
  pages: Page[];
  groups: Group[];
  labels: Label[];
}) {
  const t = useTranslations('groups');
  const tCommon = useTranslations('common');
  const router = useRouter();

  const [editing, setEditing] = useState<Editing | null>(null);
  const [query, setQuery] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [newLabel, setNewLabel] = useState('');
  const [newColor, setNewColor] = useState<PaletteKey>(PALETTE_KEYS[labels.length % PALETTE_KEYS.length]!);
  const [labelEdit, setLabelEdit] = useState<{ id: string; name: string; color: PaletteKey } | null>(null);

  const pageById = new Map(pages.map((page) => [page.id, page]));
  const close = useCallback(() => {
    setEditing(null);
    setError(null);
  }, []);

  async function call(url: string, init: RequestInit, done: string): Promise<boolean> {
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(url, { headers: { 'content-type': 'application/json' }, ...init });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string; fields?: Record<string, string> };
        setError(Object.values(body.fields ?? {})[0] ?? body.error ?? tCommon('genericError'));
        return false;
      }
      setNotice(done);
      router.refresh();
      return true;
    } catch {
      setError(tCommon('genericError'));
      return false;
    } finally {
      setPending(false);
    }
  }

  async function saveGroup() {
    if (!editing) return;
    const body = JSON.stringify({ name: editing.name, color: editing.color, targetIds: editing.targetIds });
    const ok = editing.id
      ? await call(`/api/page-groups/${editing.id}`, { method: 'PATCH', body }, t('groupSaved', { name: editing.name }))
      : await call('/api/page-groups', { method: 'POST', body }, t('groupCreated', { name: editing.name }));
    if (ok) close();
  }

  async function removeGroup(group: Group) {
    if (!window.confirm(t('deleteGroupConfirm', { name: group.name }))) return;
    await call(`/api/page-groups/${group.id}`, { method: 'DELETE' }, t('groupDeleted', { name: group.name }));
  }

  async function addLabel() {
    const name = newLabel.trim();
    if (!name) return;
    if (await call('/api/labels', { method: 'POST', body: JSON.stringify({ name, color: newColor }) }, t('labelCreated', { name }))) {
      setNewLabel('');
      setNewColor(PALETTE_KEYS[(labels.length + 1) % PALETTE_KEYS.length]!);
    }
  }

  async function saveLabel() {
    if (!labelEdit) return;
    if (
      await call(
        `/api/labels/${labelEdit.id}`,
        { method: 'PATCH', body: JSON.stringify({ name: labelEdit.name, color: labelEdit.color }) },
        t('labelSaved', { name: labelEdit.name }),
      )
    ) {
      setLabelEdit(null);
    }
  }

  async function removeLabel(label: Label) {
    if (!window.confirm(t('deleteLabelConfirm', { name: label.name, count: label.posts }))) return;
    await call(`/api/labels/${label.id}`, { method: 'DELETE' }, t('labelDeleted', { name: label.name }));
  }

  const needle = query.trim().toLowerCase();
  const listed = needle ? pages.filter((page) => page.name.toLowerCase().includes(needle)) : pages;

  return (
    <div className="space-y-6">
      {(notice || (error && !editing)) && (
        <p
          role={error ? 'alert' : 'status'}
          className={`rounded-lg border px-3 py-2 text-sm ${
            error ? 'border-red-200 bg-red-50 text-red-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'
          }`}
        >
          {error ?? notice}
        </p>
      )}

      {/* Page groups */}
      <section aria-labelledby="groups-title" className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3 px-1">
          <div>
            <h2 id="groups-title" className="text-[17px] font-bold text-slate-900">
              {t('groupsTitle')}
            </h2>
            <p className="text-sm text-slate-600">{t('groupsHint')}</p>
          </div>
          {canManageGroups && pages.length > 0 && (
            <button
              type="button"
              className="btn-primary"
              onClick={() => setEditing({ kind: 'group', id: null, name: '', color: PALETTE_KEYS[groups.length % PALETTE_KEYS.length]!, targetIds: [] })}
            >
              <Icon name="plus" size={16} />
              {t('newGroup')}
            </button>
          )}
        </div>

        {groups.length === 0 ? (
          <EmptyState icon="folders" title={t('noGroups')} hint={t('noGroupsHint')} />
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {groups.map((group) => {
              const members = group.targetIds.map((id) => pageById.get(id)).filter((page): page is Page => Boolean(page));
              return (
                <li key={group.id} className="card flex flex-col p-4">
                  <div className="flex items-start gap-3">
                    <span className={`mt-1 h-3 w-3 shrink-0 rounded-full ${paletteOf(group.color).dot}`} aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[15px] font-semibold text-slate-900">{group.name}</p>
                      <p className="text-[13px] text-slate-600">{t('pageCount', { count: members.length })}</p>
                    </div>
                    {canManageGroups && (
                      <div className="flex shrink-0 gap-1">
                        <button
                          type="button"
                          className="flex h-8 w-8 items-center justify-center rounded-full text-slate-600 hover:bg-slate-100"
                          aria-label={t('editGroup', { name: group.name })}
                          onClick={() => setEditing({ kind: 'group', id: group.id, name: group.name, color: group.color, targetIds: group.targetIds })}
                        >
                          <Icon name="pencil" size={16} />
                        </button>
                        <button
                          type="button"
                          className="flex h-8 w-8 items-center justify-center rounded-full text-slate-600 hover:bg-red-50 hover:text-red-600"
                          aria-label={t('deleteGroup', { name: group.name })}
                          disabled={pending}
                          onClick={() => void removeGroup(group)}
                        >
                          <Icon name="trash" size={16} />
                        </button>
                      </div>
                    )}
                  </div>
                  {members.length > 0 ? (
                    <ul className="mt-3 flex items-center" aria-label={t('pagesIn', { name: group.name })}>
                      {members.slice(0, 7).map((page, index) => (
                        <li key={page.id} className={`rounded-full ring-2 ring-white ${index ? '-ml-2' : ''}`} title={page.name}>
                          <FeedAvatar name={page.name} pictureUrl={page.pictureUrl} size="sm" />
                        </li>
                      ))}
                      {members.length > 7 && (
                        <li className="-ml-2 flex h-8 w-8 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-700 ring-2 ring-white">
                          +{members.length - 7}
                        </li>
                      )}
                    </ul>
                  ) : (
                    <p className="mt-3 text-xs text-slate-500">{t('emptyGroup')}</p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Labels */}
      <section aria-labelledby="labels-title" className="card p-4 sm:p-5">
        <h2 id="labels-title" className="text-[17px] font-bold text-slate-900">
          {t('labelsTitle')}
        </h2>
        <p className="mt-0.5 text-sm text-slate-600">{t('labelsHint')}</p>

        {labels.length === 0 ? (
          <p className="mt-4 text-sm text-slate-500">{t('noLabels')}</p>
        ) : (
          <ul className="mt-4 divide-y divide-slate-100">
            {labels.map((label) =>
              labelEdit?.id === label.id ? (
                <li key={label.id} className="flex flex-wrap items-center gap-2 py-2.5">
                  <input
                    className="input w-auto min-w-[10rem] flex-1 py-1.5 text-sm"
                    value={labelEdit.name}
                    maxLength={40}
                    aria-label={t('labelName')}
                    onChange={(event) => setLabelEdit({ ...labelEdit, name: event.target.value })}
                  />
                  <Swatches value={labelEdit.color} onChange={(color) => setLabelEdit({ ...labelEdit, color })} label={t('color')} />
                  <button type="button" className="btn-primary" disabled={pending || !labelEdit.name.trim()} onClick={() => void saveLabel()}>
                    {tCommon('save')}
                  </button>
                  <button type="button" className="btn-secondary" onClick={() => setLabelEdit(null)}>
                    {tCommon('cancel')}
                  </button>
                </li>
              ) : (
                <li key={label.id} className="flex items-center gap-3 py-2.5">
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-sm font-semibold ring-1 ring-inset ${paletteOf(label.color).chip}`}
                  >
                    <span aria-hidden className={`h-2 w-2 rounded-full ${paletteOf(label.color).dot}`} />
                    {label.name}
                  </span>
                  <span className="nums flex-1 text-xs text-slate-500">{t('labelPosts', { count: label.posts })}</span>
                  {canManageLabels && (
                    <span className="flex gap-1">
                      <button
                        type="button"
                        className="flex h-8 w-8 items-center justify-center rounded-full text-slate-600 hover:bg-slate-100"
                        aria-label={t('editLabel', { name: label.name })}
                        onClick={() => setLabelEdit({ id: label.id, name: label.name, color: label.color })}
                      >
                        <Icon name="pencil" size={15} />
                      </button>
                      <button
                        type="button"
                        className="flex h-8 w-8 items-center justify-center rounded-full text-slate-600 hover:bg-red-50 hover:text-red-600"
                        aria-label={t('deleteLabel', { name: label.name })}
                        disabled={pending}
                        onClick={() => void removeLabel(label)}
                      >
                        <Icon name="trash" size={15} />
                      </button>
                    </span>
                  )}
                </li>
              ),
            )}
          </ul>
        )}

        <form
          className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4"
          onSubmit={(event) => {
            event.preventDefault();
            void addLabel();
          }}
        >
          <input
            className="input w-auto min-w-[12rem] flex-1"
            placeholder={t('newLabelPlaceholder')}
            aria-label={t('labelName')}
            value={newLabel}
            maxLength={40}
            onChange={(event) => setNewLabel(event.target.value)}
          />
          <Swatches value={newColor} onChange={setNewColor} label={t('color')} />
          <button type="submit" className="btn-secondary" disabled={pending || !newLabel.trim()}>
            <Icon name="plus" size={15} />
            {t('addLabel')}
          </button>
        </form>
      </section>

      <Dialog
        open={editing !== null}
        title={editing?.id ? t('editGroupTitle') : t('newGroupTitle')}
        onClose={close}
        closeLabel={tCommon('close')}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={close}>
              {tCommon('cancel')}
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={pending || !editing?.name.trim()}
              onClick={() => void saveGroup()}
            >
              {pending ? tCommon('working') : editing?.id ? tCommon('save') : t('createGroup')}
            </button>
          </>
        }
      >
        {editing && (
          <div className="space-y-4">
            {error && (
              <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </p>
            )}
            <div>
              <label className="label" htmlFor="group-name">
                {t('groupName')}
              </label>
              <input
                id="group-name"
                className="input"
                value={editing.name}
                maxLength={40}
                placeholder={t('groupNamePlaceholder')}
                onChange={(event) => setEditing({ ...editing, name: event.target.value })}
              />
            </div>
            <div>
              <p className="label">{t('color')}</p>
              <Swatches value={editing.color} onChange={(color) => setEditing({ ...editing, color })} label={t('color')} large />
            </div>
            <div>
              <div className="flex items-center justify-between">
                <p className="label mb-0">{t('pagesInGroup')}</p>
                <span className="nums text-xs text-slate-500">
                  {t('selectedOf', { selected: editing.targetIds.length, total: pages.length })}
                </span>
              </div>
              {pages.length > 6 && (
                <input
                  className="input mt-2 py-1.5 text-sm"
                  placeholder={t('searchPages')}
                  aria-label={t('searchPages')}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              )}
              <ul className="mt-2 max-h-72 space-y-0.5 overflow-y-auto rounded-lg border border-slate-200 p-1.5">
                {listed.map((page) => {
                  const on = editing.targetIds.includes(page.id);
                  return (
                    <li key={page.id}>
                      <label className={`flex cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 ${on ? 'bg-brand-50' : 'hover:bg-slate-50'}`}>
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-slate-300 text-brand-500 focus:ring-brand-500"
                          checked={on}
                          onChange={() =>
                            setEditing({
                              ...editing,
                              targetIds: on ? editing.targetIds.filter((id) => id !== page.id) : [...editing.targetIds, page.id],
                            })
                          }
                        />
                        <FeedAvatar name={page.name} pictureUrl={page.pictureUrl} size="sm" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold text-slate-900">{page.name}</span>
                          {page.category && <span className="block truncate text-xs text-slate-500">{page.category}</span>}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}

function Swatches({
  value,
  onChange,
  label,
  large = false,
}: {
  value: PaletteKey;
  onChange: (color: PaletteKey) => void;
  label: string;
  large?: boolean;
}) {
  const t = useTranslations('groups');
  return (
    <span role="radiogroup" aria-label={label} className="flex flex-wrap items-center gap-1.5">
      {PALETTE_KEYS.map((key) => (
        <button
          key={key}
          type="button"
          role="radio"
          aria-checked={value === key}
          aria-label={t(`colors.${key}`)}
          className={`flex items-center justify-center rounded-full ${large ? 'h-8 w-8' : 'h-6 w-6'} ${paletteOf(key).dot} ${
            value === key ? 'ring-2 ring-slate-900 ring-offset-2' : 'hover:scale-110'
          } transition-transform`}
          onClick={() => onChange(key)}
        >
          {value === key && <Icon name="check" size={large ? 16 : 13} className="text-white" strokeWidth={2.5} />}
        </button>
      ))}
    </span>
  );
}
