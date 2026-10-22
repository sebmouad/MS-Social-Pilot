'use server';

import { runtimeConfig } from '@/server/config/store';
import { requireViewer } from '@/server/context';
import { readInboxList } from '../server/read';
import { loadInboxCustomerCopy } from '../server/customer-copy';
import { inboxListInput, inboxListLocation, type InboxLocation } from '../query';
import { inboxLocale } from './locale';
import { inboxScope } from './scope';
import { inboxListAbilities, inboxListRows } from './InboxListRows';
import type { InboxListContinuation } from './InboxList';

/** Thin read entry point. Each continuation repeats current session and shared-service
 * authorization; the opaque cursor also binds the workspace and selected channels.
 * It never accepts an actor, workspace, permission map or rendered content from the browser.
 */
export async function loadMoreInboxRows(location: InboxLocation): Promise<InboxListContinuation> {
  try {
    const viewer = await requireViewer({ feature: 'inbox/conversations', channelScoped: true });
    const actor = { userId: viewer.user.id, workspaceId: viewer.workspaceId };
    const scope = await inboxScope(viewer, location.channel);
    const { channel: _scope, ...filters } = location;
    const page = await readInboxList(actor, inboxListInput(filters), scope.constraints);
    const [abilities, catalog, locale, previewMaxCharacters] = await Promise.all([inboxListAbilities(actor, page), loadInboxCustomerCopy(), inboxLocale(), runtimeConfig('inbox.listPreviewMaxCharacters')]);
    return { ok: true, rows: inboxListRows(page, abilities, { ...inboxListLocation(page), ...(scope.param ? { channel: scope.param } : {}) }, location.thread, locale, catalog, previewMaxCharacters), olderCursor: page.olderCursor, total: page.total };
  } catch {
    // Session loss, changed scope/cursors and infrastructure failures retain the
    // existing rows and use the Root-managed customer recovery copy in the client.
    return { ok: false };
  }
}
