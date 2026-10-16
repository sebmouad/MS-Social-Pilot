/** Preserve unavailable URL selections instead of silently showing “all”. */
export function PublishingChannelOptions({ channels, selected }: { channels: Array<{ id: string; name: string }>; selected: string | null }) {
  return <>
    <option value="">All selected channels</option>
    {selected && !channels.some(channel => channel.id === selected) ? <option value={selected}>Unavailable channel</option> : null}
    {channels.map(channel => <option value={channel.id} key={channel.id}>{channel.name}</option>)}
  </>;
}
