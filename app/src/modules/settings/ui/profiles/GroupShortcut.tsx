'use client';
import { useSettingsCopy } from '@/modules/settings/ui/copy-context';
import { useRef } from 'react';
import { Select } from '@/components/Select';
import type { ChannelGroup } from '../../channel-profiles/contracts';

/** A shortcut never expands the current picker's accessible choices. */
export function GroupShortcut({ groups, allowedIds, onSelect, locale = 'en', disabled = false }: { groups: ChannelGroup[]; allowedIds: string[]; onSelect?: (ids: string[]) => void; locale?: 'en' | 'fr'; disabled?: boolean }) {
  const label = useRef<HTMLLabelElement>(null);
  const available = groups.map(group => ({ ...group, channelIds: group.channelIds.filter(id => allowedIds.includes(id)) })).filter(group => group.channelIds.length);
  if (!available.length) return null;
  const c = useSettingsCopy('profiles', locale);
  return <label ref={label} className="ui-field">{c.shortcut}<Select aria-label={c.shortcut} disabled={disabled} value="" options={[{ value: '', label: c.choose }, ...available.map(group => ({ value: group.id, label: group.name }))]} onChange={value => {
    const ids = available.find(group => group.id === value)?.channelIds;
    if (!ids) return;
    if (onSelect) onSelect(ids);
    else label.current?.closest('form')?.querySelectorAll<HTMLInputElement>('input[type="checkbox"][name="channel"]').forEach(input => { input.checked = ids.includes(input.value); });
  }} /></label>;
}
