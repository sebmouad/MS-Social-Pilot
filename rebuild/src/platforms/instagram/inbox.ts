import type { InboxItem, InboxCommentsRequest, InboxActionRequest, InboxRequest } from '../types';
import type { InstagramPolicy } from './config';
import { InstagramError, object, type InstagramGraph } from './transport';
import { requireScopes } from './publishing';

export function createInstagramInbox(policy: InstagramPolicy, graph: InstagramGraph) {
  async function listComments(request: InboxCommentsRequest): Promise<InboxItem[]> {
    requireScopes(graph, request.credential, policy.commentScopes);
    // Match the media owner before traversing comments, even if a valid remote id is supplied.
    const media = await graph.request(request.remotePostId, request.credential.accessToken, { fields: 'owner' });
    if ((object(media.owner).id ?? media.owner) !== request.targetId) throw new InstagramError(graph.text('permission'), 'rejected');
    const result = await graph.list(`${request.remotePostId}/comments`, request.credential.accessToken, { fields: 'id,text,timestamp,from,parent_id' });
    const rows: InboxItem[] = [];
    function map(row: Record<string, unknown>, parentId: string | null) {
      const createdAt = typeof row.timestamp === 'string' ? new Date(row.timestamp) : null;
      if (typeof row.id !== 'string' || typeof row.text !== 'string' || !createdAt || !Number.isFinite(createdAt.getTime())) return;
      const from = object(row.from);
      rows.push({ id: row.id, text: row.text, createdAt, targetId: request.targetId, kind: 'comment', parentId,
        authorId: typeof from.id === 'string' ? from.id : null, authorName: typeof from.username === 'string' ? from.username : null });
    }
    for (const row of result.items) {
      map(row, typeof row.parent_id === 'string' ? row.parent_id : null);
      if (typeof row.id !== 'string') continue;
      const replies = await graph.list(`${row.id}/replies`, request.credential.accessToken, { fields: 'id,text,timestamp,from' });
      for (const reply of replies.items) map(reply, row.id);
      if (replies.truncated) throw new InstagramError(graph.text('unavailable'), 'uncertain');
    }
    if (result.truncated) throw new InstagramError(graph.text('unavailable'), 'uncertain');
    return rows;
  }
  async function listInbox(request: InboxRequest) {
    requireScopes(graph, request.credential, policy.commentScopes);
    const media = await graph.list(`${request.targetId}/media`, request.credential.accessToken, { fields: 'id' });
    const rows: InboxItem[] = [];
    for (const post of media.items) if (typeof post.id === 'string') rows.push(...await listComments({ ...request, remotePostId: post.id }));
    if (media.truncated) throw new InstagramError(graph.text('unavailable'), 'uncertain');
    return rows;
  }
  // Action target/tenant authorization belongs to the shared Inbox service; this adapter requires provider grants.
  async function replyToInbox(request: InboxActionRequest) {
    requireScopes(graph, request.credential, policy.commentScopes);
    if (!request.text?.trim()) throw new InstagramError(graph.text('invalid'), 'rejected');
    const result = await graph.request(`${request.remoteId}/replies`, request.credential.accessToken, { message: request.text }, 'POST');
    if (typeof result.id !== 'string' || !result.id) throw new InstagramError(graph.text('uncertain'), 'uncertain');
    return { remoteId: result.id };
  }
  async function hideInboxItem(request: InboxActionRequest & { hidden: boolean }) {
    requireScopes(graph, request.credential, policy.commentScopes);
    const result = await graph.request(request.remoteId, request.credential.accessToken, { hide: String(request.hidden) }, 'POST');
    if (result.success !== true) throw new InstagramError(graph.text('uncertain'), 'uncertain');
  }
  async function deleteInboxItem(request: InboxActionRequest) {
    requireScopes(graph, request.credential, policy.commentScopes);
    const result = await graph.request(request.remoteId, request.credential.accessToken, {}, 'DELETE');
    if (result.success !== true) throw new InstagramError(graph.text('uncertain'), 'uncertain');
  }
  return { listComments, listInbox, replyToInbox, hideInboxItem, deleteInboxItem };
}
