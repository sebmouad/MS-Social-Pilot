import { z } from 'zod';
export type ProfileActor = { userId: string; workspaceId: string; allowedChannelIds?: readonly string[] };
export type ProfileFeature = 'settings/connections' | 'publishing/posts' | 'analytics/overview';
export type ChannelProfile = { id: string; name: string; labels: string[] };
export type ChannelGroup = { id: string; name: string; channelIds: string[] };
export type ProfileDirectory = { channels: ChannelProfile[]; groups: ChannelGroup[] };
const id = z.string().trim().min(1).max(200).refine(value => !/[\u0000-\u001f\u007f]/.test(value));
const name = z.string().trim().min(1).max(200).refine(value => !/[\u0000-\u001f\u007f]/.test(value));
export const profileAction = z.discriminatedUnion('action', [
  z.object({ action: z.literal('saveGroup'), id: id.optional(), name, channelIds: z.array(id).min(1).max(10000) }).strict(),
  z.object({ action: z.literal('deleteGroup'), id, confirmation: z.string().max(300) }).strict(),
  z.object({ action: z.literal('setLabels'), channelId: id, labels: z.array(name.refine(value => !value.includes(','))).max(100) }).strict(),
]);
export const deleteGroupConfirmation = (id: string) => `DELETE CHANNEL GROUP ${id}`;
export function scopedGroups(groups: ChannelGroup[], channelIds: readonly string[]): ChannelGroup[] {
  const allowed = new Set(channelIds);
  return groups.map(group => ({ ...group, channelIds: group.channelIds.filter(id => allowed.has(id)) })).filter(group => group.channelIds.length > 0);
}
export function profileChannelName(channel: ChannelProfile) { return channel.labels.length ? `${channel.name} · ${channel.labels.join(', ')}` : channel.name; }
