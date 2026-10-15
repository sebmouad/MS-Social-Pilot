'use client';

import { useId, useMemo, useState } from 'react';
import { PlatformMark } from '@/components/ChannelChip';
import type { ComposeModule } from '@/lib/publishing/compose-rules';
import styles from './compose.module.css';

export type PickerChannel = { id: string; name: string; kindLabel: string; provider: string | null; pictureUrl: string | null };

/** Enabled channels grouped by platform module, with search and select-all per platform. */
export function ChannelPicker({ channels, modules, selected, maxTargets, onChange, error }: {
  channels: PickerChannel[];
  modules: ComposeModule[];
  selected: ReadonlySet<string>;
  maxTargets: number;
  onChange: (next: Set<string>) => void;
  error?: string;
}) {
  const [query, setQuery] = useState('');
  const searchId = useId();
  const errorId = useId();
  const needle = query.trim().toLocaleLowerCase();

  const groups = useMemo(() => {
    const known = new Map(modules.map(module => [module.id, module]));
    const byGroup = new Map<string, { key: string; module: ComposeModule | null; label: string; channels: PickerChannel[] }>();
    for (const channel of channels) {
      const module = channel.provider ? known.get(channel.provider) ?? null : null;
      const key = module?.id ?? 'other';
      const group = byGroup.get(key) ?? { key, module, label: module?.name ?? 'Other channels', channels: [] };
      group.channels.push(channel);
      byGroup.set(key, group);
    }
    return [...byGroup.values()].map(group => ({
      ...group,
      visible: group.channels.filter(channel => !needle || `${channel.name} ${channel.kindLabel} ${group.label}`.toLocaleLowerCase().includes(needle)),
    }));
  }, [channels, modules, needle]);

  const atLimit = selected.size >= maxTargets;
  const toggle = (id: string, on: boolean) => {
    const next = new Set(selected);
    if (on) next.add(id); else next.delete(id);
    onChange(next);
  };
  const setGroup = (ids: string[], on: boolean) => {
    const next = new Set(selected);
    for (const id of ids) { if (!on) next.delete(id); else if (next.size < maxTargets) next.add(id); }
    onChange(next);
  };
  const anyVisible = groups.some(group => group.visible.length);

  return <div className={styles.channelPicker}>
    <div className="ui-field">
      <label className="ui-label" htmlFor={searchId}>Search channels</label>
      <input id={searchId} className="ui-input" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Name or platform" autoComplete="off" />
    </div>
    <p className={styles.selectedCount} role="status">
      {selected.size === 0 ? 'No channels selected. You can still save a draft.' : `${selected.size} ${selected.size === 1 ? 'channel' : 'channels'} selected`}
      {atLimit ? ` (the most one post can use is ${maxTargets})` : ''}
      {selected.size ? <> · <button type="button" className={styles.linkButton} onClick={() => onChange(new Set())}>Clear selection</button></> : null}
    </p>
    {!anyVisible ? <p className={styles.muted} role="status">No channels match “{query}”.</p> : null}
    <div className={styles.channelGroups} aria-describedby={error ? errorId : undefined}>
      {groups.filter(group => group.visible.length).map(group => {
        const ids = group.visible.map(channel => channel.id);
        const allOn = ids.every(id => selected.has(id));
        return <fieldset key={group.key} className={styles.channelGroup}>
          <legend>
            {group.module ? <PlatformMark mark={group.module.mark} /> : null}
            <span>{group.label}</span>
            <span className={styles.groupCount}>{group.visible.length === group.channels.length ? group.channels.length : `${group.visible.length} of ${group.channels.length}`}</span>
          </legend>
          <button type="button" className={styles.groupToggle} onClick={() => setGroup(ids, !allOn)} aria-label={`${allOn ? 'Clear' : 'Select all'} ${group.label} channels`}>{allOn ? 'Clear all' : 'Select all'}</button>
          <ul>
            {group.visible.map(channel => {
              const checked = selected.has(channel.id);
              return <li key={channel.id}>
                <label className={styles.channelRow} data-checked={checked || undefined}>
                  <input type="checkbox" checked={checked} disabled={!checked && atLimit} onChange={event => toggle(channel.id, event.currentTarget.checked)} />
                  <span className={styles.avatar} aria-hidden="true">{channel.pictureUrl ? <img src={channel.pictureUrl} alt="" width={32} height={32} loading="lazy" /> : channel.name.trim().charAt(0).toUpperCase()}</span>
                  <span className={styles.channelText}><strong>{channel.name}</strong><small>{channel.kindLabel}</small></span>
                </label>
              </li>;
            })}
          </ul>
        </fieldset>;
      })}
    </div>
    {error ? <p id={errorId} className="ui-field-error" role="alert">{error}</p> : null}
  </div>;
}
