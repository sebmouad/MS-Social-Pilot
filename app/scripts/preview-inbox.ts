import type { PrismaClient } from '../generated/client';

/** Synthetic data only: refuses remote/production targets and non-preview resource identifiers. */
export async function preparePreviewInbox(prisma: PrismaClient, input: { workspaceId: string; targetId: string; userId: string; now: Date }) {
  if (process.env.NODE_ENV === 'production' || process.env.PREVIEW_SEED_CONFIRM !== 'SEED_LOCAL_REBUILD_PREVIEW') throw new Error('Confirm isolated local preview seeding before adding Inbox examples.');
  const url = new URL(process.env.DATABASE_URL ?? '');
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname) || !/(?:_preview|_test)$/.test(decodeURIComponent(url.pathname)) || ['host', 'hostaddr', 'socket'].some(key => url.searchParams.has(key))) throw new Error('Inbox examples require an isolated loopback preview database.');
  if (![input.workspaceId, input.targetId, input.userId].every(id => /^preview_[A-Za-z0-9_-]+$/.test(id))) throw new Error('Inbox examples require preview_ fixture identifiers.');
  const [target, member] = await Promise.all([
    prisma.target.findFirst({ where: { id: input.targetId, workspaceId: input.workspaceId, enabled: true }, select: { id: true, name: true, providerId: true } }),
    prisma.membership.findUnique({ where: { userId_workspaceId: { userId: input.userId, workspaceId: input.workspaceId } }, select: { id: true } }),
  ]);
  if (!target || !member || !target.providerId.startsWith('preview_')) throw new Error('Seed the synthetic workspace and selected channel before Inbox examples.');
  const id = `${input.workspaceId}_conversation_history`;
  const existing = await prisma.conversation.findUnique({ where: { id }, select: { targetId: true, remoteId: true } });
  if (existing && (existing.targetId !== input.targetId || existing.remoteId !== id)) throw new Error('Reserved Inbox example identifier has unexpected data; refusing to replace it.');
  const count = 54; // Fixture size intentionally exceeds the default history page.
  const visitor = `${input.workspaceId}_visitor_history`;
  const topics = [
    ['Could you share the format options for our campaign?', 'We can prepare square, portrait and landscape versions for review.'],
    ['Can we include the short headline on the first frame?', 'Yes. We will keep the headline readable and send a preview.'],
    ['The preview looks clear. Can we compare the alternate background?', 'We saved both versions so your team can compare them.'],
    ['Please keep the simpler background and the larger text.', 'The updated draft uses those choices and is ready for review.'],
    ['Can we check the scheduled date before approving?', 'The draft remains in review until your team approves the final time.'],
    ['Thanks. Please send the final proof with the caption.', 'Here is the final proof and caption for your approval.'],
  ];
  await prisma.$transaction(async tx => {
    await tx.conversation.upsert({ where: { id }, create: { id, targetId: input.targetId, remoteId: id, snippet: 'Thanks. The latest campaign proof is ready for our review.', unreadCount: 1, messageCount: count, participants: [{ id: visitor, name: 'Alex Preview' }], updatedTime: input.now, fetchedAt: input.now }, update: { snippet: 'Thanks. The latest campaign proof is ready for our review.', unreadCount: 1, messageCount: count, resolvedAt: null, updatedTime: input.now, fetchedAt: input.now } });
    for (let index = 0; index < count; index++) {
      const fromChannel = index % 2 === 1 && index !== count - 1;
      const remoteId = `${id}_entry_${String(index).padStart(3, '0')}`;
      const createdTime = new Date(input.now.getTime() - (count - 1 - index) * 45 * 60000);
      const body = index === count - 1 ? 'Thanks. The latest campaign proof is ready for our review.' : `${topics[Math.floor(index / 2) % topics.length][fromChannel ? 1 : 0]} (Example revision ${Math.floor(index / 2) + 1})`;
      const values = { fromName: fromChannel ? target.name : 'Alex Preview', fromId: fromChannel ? target.providerId : visitor, sentById: fromChannel ? input.userId : null, message: body, createdTime };
      await tx.conversationMessage.upsert({ where: { conversationId_remoteId: { conversationId: id, remoteId } }, create: { id: remoteId, conversationId: id, remoteId, ...values }, update: values });
    }
  });
  return { id, entries: count };
}
