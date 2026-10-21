'use client';
import { usePublishingCopy } from './kit/CopyProvider';
/** Preserve unavailable URL selections instead of silently showing “all”. */
export function PublishingChannelOptions({ channels, selected, groupIds = [] }: { channels: Array<{ id: string; name: string }>; selected: string | null; groupIds?: string[] }) {
  const copy = usePublishingCopy();
  return <>
    <option value="">{copy.allChannels}</option>
    {selected && !channels.some(channel => channel.id === selected) && !groupIds.some(id => selected === `channel-group:${id}`) ? <option value={selected}>{copy.unavailableChannelOption}</option> : null}
    {channels.map(channel => <option value={channel.id} key={channel.id}>{channel.name}</option>)}
  </>;
}
