/** Preserve unavailable URL selections instead of silently showing “all”. */
export function PublishingChannelOptions({ channels, selected, groupIds = [] }: { channels: Array<{ id: string; name: string }>; selected: string | null; groupIds?: string[] }) {
  return <>
    <option value="">All selected channels</option>
    {selected && !channels.some(channel => channel.id === selected) && !groupIds.some(id => selected === `channel-group:${id}`) ? <option value={selected}>Unavailable channel</option> : null}
    {channels.map(channel => <option value={channel.id} key={channel.id}>{channel.name}</option>)}
  </>;
}
