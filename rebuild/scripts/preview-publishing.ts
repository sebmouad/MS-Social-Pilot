import { PrismaClient } from '../generated/client';
const id = 'preview_publishing_recovery_test';
const workspaceId = 'preview_workspace';
const userId = 'preview_qa_user';
const message = 'Preview: publishing recovery test';
async function main() {
  const raw = process.env.DATABASE_URL;
  if (!raw || process.env.NODE_ENV === 'production') throw new Error('Local preview only.');
  const url = new URL(raw);
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !decodeURIComponent(url.pathname).endsWith('_preview') || ['host', 'hostaddr', 'socket'].some(key => url.searchParams.has(key))) throw new Error('Isolated loopback preview required.');
  const action = process.argv[2];
  if (!['seed', 'seed-success', 'seed-comment-review', 'cleanup'].includes(action)) throw new Error('Choose seed, seed-success, seed-comment-review or cleanup.');
  const client = new PrismaClient();
  try {
    const post = await client.post.findUnique({ where: { id } });
    if (action !== 'cleanup') {
      if (post) throw new Error('The disposable Publishing fixture already exists.');
      if (!await client.target.findFirst({ where: { id: 'preview_target_north', workspaceId, enabled: true } }) || !await client.user.findUnique({ where: { id: userId } })) throw new Error('The synthetic preview examples are required.');
      const commentReview = action === 'seed-comment-review';
      await client.post.create({ data: { id, workspaceId, authorId: userId, message, firstComment: 'Preview first comment retained on failure', media: [], status: commentReview ? 'published' : 'draft', publishedAt: commentReview ? new Date() : null, createdAt: new Date(), updatedAt: new Date(), targets: { create: { id: `${id}_target`, targetId: 'preview_target_north', status: commentReview ? 'published' : action === 'seed' ? 'processing' : 'pending', remotePostId: action === 'seed' || commentReview ? 'preview_fake_remote_publish_recovery_test' : null, ...(commentReview ? { firstCommentAt: new Date(), firstCommentError: 'Synthetic provider detail must stay server-side' } : {}) } } } });
      console.log('Disposable Publishing recovery example created; no remote operation dispatched.');
    } else {
      if (post && (post.workspaceId !== workspaceId || post.authorId !== userId || post.message !== message)) throw new Error('Refusing cleanup: the fixture no longer matches its original example.');
      await client.$transaction(async tx => {
        await tx.postTarget.deleteMany({ where: { postId: id, post: { workspaceId } } });
        await tx.post.deleteMany({ where: { id, workspaceId, authorId: userId } });
      });
      if (await client.post.count({ where: { id } }) || await client.postTarget.count({ where: { postId: id } })) throw new Error('Fixture cleanup could not be confirmed.');
      console.log('Disposable Publishing recovery example cleanup verified.');
    }
  } finally { await client.$disconnect(); }
}
main().catch(error => { console.error('The guarded Publishing preview operation failed.', error && typeof error === 'object' && 'code' in error ? String(error.code) : error instanceof Error ? error.name : 'unknown'); process.exitCode = 1; });
