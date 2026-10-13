'use client';

import { NetworkGroups } from './NetworkGroups';
import { NetworkMark } from './NetworkMark';
import { useState } from 'react';
import { useTranslations } from 'next-intl';

import { targetTypeKey } from '@/lib/constants';
import { paletteOf } from '@/lib/palette';
import { blockerMessage } from './blockerMessage';

export interface TargetOption {
  id: string;
  name: string;
  type: string;
  pictureUrl: string | null;
  canPublish: boolean;
  publishBlocker: string | null;
  publishBlockerCode: string | null;
  accountName: string | null;
}

interface Props {
  targets: TargetOption[];
  selected: string[];
  onChange: (selected: string[]) => void;
  /** Page groups: one click ticks, or unticks, every Page in one. */
  groups?: Array<{ id: string; name: string; color: string; targetIds: string[] }>;
}

export function TargetPicker({ targets, selected, onChange, groups = [] }: Props) {
  const t = useTranslations('targets');
  // The blocker copy lives with the connections screen, which is where the
  // reasons are acted on; this screen only repeats them.
  const tBlocked = useTranslations('connections');
  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();
  // Ticked destinations always stay in view, so a search never hides a choice already made.
  const listed = needle ? targets.filter((target) => selected.includes(target.id) || target.name.toLowerCase().includes(needle)) : targets;

  function toggle(target: TargetOption) {
    if (selected.includes(target.id)) {
      onChange(selected.filter((value) => value !== target.id));
    } else if (target.canPublish) {
      onChange([...selected, target.id]);
    }
  }

  const selectable = targets.filter((target) => target.canPublish);
  const allSelected = selectable.length > 0 && selectable.every((target) => selected.includes(target.id));

  if (targets.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-600">
        {t('noneConnected')}{' '}
        <a href="/connections" className="font-medium text-brand-600 hover:underline">
          {t('connectAnAccount')}
        </a>{' '}
        {t('toStart')}
      </div>
    );
  }

  // A group counts as picked when every Page of it that can take a post is.
  const groupPages = (group: { targetIds: string[] }) =>
    selectable.filter((target) => group.targetIds.includes(target.id)).map((target) => target.id);
  const usableGroups = groups.filter((group) => groupPages(group).length > 0);

  function toggleGroup(group: { targetIds: string[] }) {
    const ids = groupPages(group);
    const all = ids.every((id) => selected.includes(id));
    onChange(all ? selected.filter((id) => !ids.includes(id)) : [...new Set([...selected, ...ids])]);
  }

  return (
    <div className="space-y-2">
      {usableGroups.length > 0 && (
        <div role="group" aria-label={t('groups')} className="flex flex-wrap gap-1.5 pb-1">
          {usableGroups.map((group) => {
            const ids = groupPages(group);
            const on = ids.every((id) => selected.includes(id));
            return (
              <button
                key={group.id}
                type="button"
                aria-pressed={on}
                onClick={() => toggleGroup(group)}
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset transition-colors ${
                  on ? paletteOf(group.color).chip : 'bg-white text-slate-700 ring-slate-200 hover:bg-slate-50'
                }`}
              >
                <span aria-hidden className={`h-2 w-2 rounded-full ${paletteOf(group.color).dot}`} />
                {group.name}
                <span className="nums opacity-70">{ids.length}</span>
              </button>
            );
          })}
        </div>
      )}
      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-500">
          {t('selectedOf', {
            selected: selectable.filter((target) => selected.includes(target.id)).length,
            total: selectable.length,
          })}
        </span>
        <button
          type="button"
          className="text-xs font-medium text-brand-600 hover:underline"
          onClick={() => onChange(allSelected ? [] : selectable.map((target) => target.id))}
        >
          {allSelected ? t('clearAll') : t('selectAll')}
        </button>
      </div>

      {targets.length > 6 && (
        <input
          type="search"
          className="input mb-2 py-1.5 text-sm"
          placeholder={t('search')}
          aria-label={t('search')}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      )}
      <div className="max-h-[22rem] space-y-1.5 overflow-y-auto rounded-lg border border-slate-200 p-2">
        {listed.length === 0 && <p className="px-2 py-3 text-sm text-slate-500">{t('noMatch')}</p>}
        <NetworkGroups items={listed} as="div" className="space-y-1.5">
          {(target) => {
            const disabled = !target.canPublish;
            const checked = selected.includes(target.id);
            // A post being edited can still name a destination switched off
            // since it was written. It stays ticked so that is visible, and it
            // can be unticked — only never ticked again.
            const locked = disabled && !checked;
            const blocked = blockerMessage(
              target.publishBlockerCode,
              target.publishBlocker,
              (key) => tBlocked(key as Parameters<typeof tBlocked>[0]),
              (key) => tBlocked.has(key as Parameters<typeof tBlocked>[0]),
            );
            return (
              <label
                key={target.id}
                title={blocked ?? undefined}
                className={`flex items-center gap-3 rounded-lg px-2 py-2 ${
                  locked
                    ? 'cursor-not-allowed opacity-60'
                    : disabled
                      ? 'cursor-pointer bg-amber-50/60 hover:bg-amber-50'
                      : 'cursor-pointer hover:bg-slate-50'
                }`}
              >
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-slate-300 text-brand-500 focus:ring-brand-500"
                  checked={checked}
                  disabled={locked}
                  onChange={() => toggle(target)}
                />
                <span className="relative shrink-0">
                  {target.pictureUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={target.pictureUrl} alt="" className="h-8 w-8 rounded-full object-cover" />
                  ) : (
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-600">
                      {target.name.slice(0, 2).toUpperCase()}
                    </span>
                  )}
                  {/* Which network, at a glance, once there is more than Facebook. */}
                  <NetworkMark network={target.type} size={14} className="absolute -bottom-0.5 -end-0.5 ring-2 ring-white" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-slate-900">{target.name}</span>
                  <span className="block break-words text-xs text-slate-500">
                    {t(targetTypeKey(target.type))}
                    {target.accountName ? ` · ${target.accountName}` : ''}
                    {disabled && blocked ? ` · ${blocked}` : ''}
                  </span>
                </span>
              </label>
            );
          }}
        </NetworkGroups>
      </div>
    </div>
  );
}
