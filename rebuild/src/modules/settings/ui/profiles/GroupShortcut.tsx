'use client';
import type { ChannelGroup } from '../../channel-profiles/contracts';
import { profileCopy } from '../../channel-profiles/copy';
/** A shortcut never expands the current picker's accessible choices. */
export function GroupShortcut({ groups, allowedIds, onSelect, locale = 'en', disabled = false }: { groups: ChannelGroup[]; allowedIds: string[]; onSelect?: (ids: string[]) => void; locale?: 'en' | 'fr'; disabled?: boolean }) {
  const available = groups.map(group => ({ ...group, channelIds: group.channelIds.filter(id => allowedIds.includes(id)) })).filter(group => group.channelIds.length);
  if (!available.length) return null;
  const c = profileCopy[locale];
  return <label className="ui-field">{c.shortcut}<select className="ui-input" disabled={disabled} value="" onChange={event => {
    const ids = available.find(group => group.id === event.target.value)?.channelIds;
    if (!ids) return;
    if (onSelect) onSelect(ids);
    else event.currentTarget.form?.querySelectorAll<HTMLInputElement>('input[type="checkbox"][name="channel"]').forEach(input => { input.checked = ids.includes(input.value); });
  }}><option value="">{c.choose}</option>{available.map(group => <option value={group.id} key={group.id}>{group.name}</option>)}</select></label>;
}
