import { PrismaClient, type PostStatus, type PostTargetStatus } from '../generated/client';
import { hashLegacyPassword } from '../src/server/auth';
import { encryptSecret } from '../src/server/secret-crypto';
import { preparePreviewInbox } from './preview-inbox';
import { preparePreviewMedia, PREVIEW_IMAGES } from './preview-media';

const FIXTURE = 'preview_';
const CONFIRMATION = 'SEED_LOCAL_REBUILD_PREVIEW';

function assertSafeTarget() {
  if (process.env.NODE_ENV === 'production') throw new Error('Preview seeding is refused when NODE_ENV=production.');
  if (process.env.PREVIEW_SEED_CONFIRM !== CONFIRMATION) {
    throw new Error(`Set PREVIEW_SEED_CONFIRM=${CONFIRMATION} to confirm local fixture seeding.`);
  }
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error('DATABASE_URL is required.');
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error('DATABASE_URL must be a valid PostgreSQL URL.'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('DATABASE_URL must use the postgres or postgresql protocol.');
  if (url.searchParams.has('host') || url.searchParams.has('hostaddr') || url.searchParams.has('socket')) throw new Error('DATABASE_URL must not contain host or socket overrides.');
  const host = url.hostname.toLowerCase();
  if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(host)) throw new Error('Preview seeding only accepts a loopback database host.');
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!/(?:_preview|_test)$/.test(database)) throw new Error('Preview seeding only accepts dedicated database names ending in _preview or _test.');
}

const email = process.env.PREVIEW_QA_EMAIL?.trim().toLowerCase();
const password = process.env.PREVIEW_QA_PASSWORD;
if (!email || !password) throw new Error('Set PREVIEW_QA_EMAIL and PREVIEW_QA_PASSWORD for the fixture sign-in.');
if (password.length < 12) throw new Error('PREVIEW_QA_PASSWORD must be at least 12 characters.');
if (!process.env.ENCRYPTION_KEY || Buffer.from(process.env.ENCRYPTION_KEY, 'base64').length !== 32) throw new Error('Set ENCRYPTION_KEY to a local-only base64-encoded 32-byte key.');

assertSafeTarget();

const prisma = new PrismaClient({ log: ['error'] });
const now = new Date();
const day = (offset: number) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offset));
const stamp = now;
const userId = `${FIXTURE}qa_user`;
const workspaceId = `${FIXTURE}workspace`;
const social = {
  primary: `${FIXTURE}social_primary`,
  expired: `${FIXTURE}social_expired`,
  invalid: `${FIXTURE}social_invalid`,
};
const targets = {
  north: `${FIXTURE}target_north`,
  studio: `${FIXTURE}target_studio`,
  hidden: `${FIXTURE}target_unselected`,
  noAudience: `${FIXTURE}target_no_audience`,
  expired: `${FIXTURE}target_expired`,
  invalid: `${FIXTURE}target_invalid`,
};
const accounts = {
  usd: `${FIXTURE}ad_usd`,
  eur: `${FIXTURE}ad_eur`,
  unselected: `${FIXTURE}ad_unselected`,
  expired: `${FIXTURE}ad_expired`,
  invalid: `${FIXTURE}ad_invalid`,
};

async function assertFixtureDatabaseIsEmpty() {
  const [otherUser, otherWorkspace] = await Promise.all([
    prisma.user.findFirst({ where: { NOT: { id: { startsWith: FIXTURE } } }, select: { id: true } }),
    prisma.workspace.findFirst({ where: { NOT: { id: { startsWith: FIXTURE } } }, select: { id: true } }),
  ]);
  if (otherUser || otherWorkspace) throw new Error('Refusing to seed: preview database contains a user or workspace outside the preview_ fixture namespace.');
}

async function setPreviewConfig() {
  const values: Record<string, unknown> = {
    'security.twoStep': 'off',
    'ads.managementEnabled': true,
    'platforms.facebook.enabled': true,
    'meta.graphBaseUrl': 'https://provider-preview.invalid',
    'meta.oauthBaseUrl': 'https://oauth-preview.invalid',
    'meta.adsReadScopes': ['ads_read'],
    'meta.adsManageScopes': ['ads_management'],
    'meta.inboxReadScopes': ['pages_messaging', 'pages_read_engagement'],
    'meta.inboxWriteScopes': ['pages_messaging', 'pages_manage_engagement'],
    'meta.postReadScopes': ['pages_read_engagement'],
  };
  for (const [key, value] of Object.entries(values)) await prisma.appSetting.upsert({
    where: { key },
    create: { key, value: value as never, encrypted: false, updatedAt: stamp },
    update: { value: value as never, encrypted: false, updatedAt: stamp },
  });
}

async function main() {
  await assertFixtureDatabaseIsEmpty();
  if (process.argv.includes('--media-only')) {
    if (!process.env.PREVIEW_MEDIA_ROOT) throw new Error('PREVIEW_MEDIA_ROOT is required for --media-only.');
    if (!await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { id: true } })) throw new Error('Seed the preview workspace before adding images.');
    const media = await preparePreviewMedia(process.env.PREVIEW_MEDIA_ROOT, workspaceId);
    const current = await prisma.appSetting.findUnique({ where: { key: 'storage.mediaRoot' }, select: { value: true } });
    if (current?.value && current.value !== media.root) throw new Error('Preview already has another media root; refusing to replace its configuration.');
    const assignments = [
      ['post_draft', 'market'], ['post_scheduled', 'market'], ['post_published', 'market'], ['post_approval', 'studio'],
    ] as const;
    await prisma.$transaction(async tx => {
      await tx.appSetting.upsert({ where: { key: 'storage.mediaRoot' }, create: { key: 'storage.mediaRoot', value: media.root, encrypted: false, updatedAt: stamp }, update: { value: media.root, encrypted: false, updatedAt: stamp } });
      for (const [post, image] of assignments) await tx.post.updateMany({
        where: { id: `${FIXTURE}${post}`, workspaceId, authorId: userId, media: { equals: [] } },
        data: { media: [{ kind: 'image', url: media[image], altText: PREVIEW_IMAGES[image].altText }] },
      });
    });
    console.log('Added synthetic image examples to empty fixture attachments only. Existing post text, states and attachments were retained.');
    return;
  }
  const images = process.env.PREVIEW_MEDIA_ROOT ? await preparePreviewMedia(process.env.PREVIEW_MEDIA_ROOT, workspaceId) : null;
  const fakeCredential = encryptSecret('FAKE_PREVIEW_CREDENTIAL_NOT_VALID');
  const fakeChannelCredential = encryptSecret('FAKE_PREVIEW_CHANNEL_TOKEN_NOT_VALID');
  await setPreviewConfig();
  if (images) await prisma.appSetting.upsert({ where: { key: 'storage.mediaRoot' }, create: { key: 'storage.mediaRoot', value: images.root, encrypted: false, updatedAt: stamp }, update: { value: images.root, encrypted: false, updatedAt: stamp } });
  const passwordHash = hashLegacyPassword(password!);
  await prisma.user.upsert({ where: { id: userId }, create: { id: userId, email: email!, name: 'Preview QA', passwordHash, isInstanceOwner: true, createdAt: stamp, updatedAt: stamp }, update: { email: email!, name: 'Preview QA', passwordHash, isInstanceOwner: true, disabledAt: null, updatedAt: stamp } });
  await prisma.$executeRaw`UPDATE users SET "emailVerifiedAt" = ${stamp} WHERE id = ${userId}`;
  await prisma.workspace.upsert({ where: { id: workspaceId }, create: { id: workspaceId, name: 'Preview QA Workspace', slug: `${FIXTURE}qa-workspace`, timezone: 'Africa/Casablanca', createdAt: stamp, updatedAt: stamp }, update: { name: 'Preview QA Workspace', timezone: 'Africa/Casablanca', updatedAt: stamp } });
  await prisma.membership.upsert({ where: { userId_workspaceId: { userId, workspaceId } }, create: { id: `${FIXTURE}membership`, userId, workspaceId, role: 'owner' }, update: { role: 'owner' } });

  const connections = [
    { id: social.primary, provider: 'facebook', providerUserId: `${FIXTURE}business`, name: 'Preview Social Suite', expires: null, invalidated: null },
    { id: social.expired, provider: 'facebook', providerUserId: `${FIXTURE}expired`, name: 'Expired Preview Connection', expires: new Date(now.getTime() - 86_400_000), invalidated: null },
    { id: social.invalid, provider: 'facebook', providerUserId: `${FIXTURE}revoked`, name: 'Reconnect Preview Connection', expires: null, invalidated: new Date(now.getTime() - 3_600_000) },
  ];
  for (const connection of connections) await prisma.socialAccount.upsert({
    where: { id: connection.id },
    create: { id: connection.id, workspaceId, provider: connection.provider, providerUserId: connection.providerUserId, name: connection.name, accessToken: fakeCredential, refreshToken: null, tokenExpiresAt: connection.expires, scopes: 'pages_show_list,pages_read_engagement,pages_manage_posts,read_insights,pages_messaging,pages_manage_engagement,ads_read,ads_management', invalidatedAt: connection.invalidated, invalidReason: connection.invalidated ? 'Synthetic preview state' : null, createdAt: stamp, updatedAt: stamp },
    update: { name: connection.name, accessToken: fakeCredential, tokenExpiresAt: connection.expires, scopes: 'pages_show_list,pages_read_engagement,pages_manage_posts,read_insights,pages_messaging,pages_manage_engagement,ads_read,ads_management', invalidatedAt: connection.invalidated, invalidReason: connection.invalidated ? 'Synthetic preview state' : null, updatedAt: stamp },
  });

  const targetRows = [
    [targets.north, social.primary, 'page', 'Preview North Market', true, true],
    [targets.studio, social.primary, 'page', 'Preview Studio', true, true],
    [targets.hidden, social.primary, 'page', 'Preview Unselected Channel', false, true],
    [targets.noAudience, social.primary, 'page', 'Preview Missing Audience', true, true],
    [targets.expired, social.expired, 'page', 'Expired Preview Channel', true, true],
    [targets.invalid, social.invalid, 'page', 'Invalid Preview Channel', true, true],
  ] as const;
  for (const [id, socialAccountId, type, name, enabled, canPublish] of targetRows) await prisma.target.upsert({
    where: { id },
    create: { id, workspaceId, socialAccountId, type, providerId: id, name, pictureUrl: null, accessToken: fakeChannelCredential, enabled, canPublish, followersCount: null, profileSyncedAt: stamp, createdAt: stamp, updatedAt: stamp },
    update: { socialAccountId, type, name, enabled, canPublish, accessToken: fakeChannelCredential, updatedAt: stamp },
  });

  const accountRows = [
    [accounts.usd, social.primary, 'Preview USD Ads', 'USD', true],
    [accounts.eur, social.primary, 'Preview EUR Ads', 'EUR', true],
    [accounts.unselected, social.primary, 'Preview Unselected Ads', 'CAD', false],
    [accounts.expired, social.expired, 'Expired Preview Ads', 'USD', true],
    [accounts.invalid, social.invalid, 'Invalid Preview Ads', 'EUR', true],
  ] as const;
  for (const [id, socialAccountId, name, currency, enabled] of accountRows) await prisma.adAccount.upsert({
    where: { id },
    create: { id, workspaceId, socialAccountId, actId: id, name, currency, accountStatus: 1, enabled, lastSyncedAt: stamp, createdAt: stamp, updatedAt: stamp },
    update: { socialAccountId, name, currency, enabled, lastSyncedAt: stamp, updatedAt: stamp },
  });

  const postRows: Array<{ id: string; message: string; status: PostStatus; scheduledAt: Date | null; publishedAt: Date | null; destinations: Array<readonly [string, PostTargetStatus]> }> = [
    { id: `${FIXTURE}post_published`, message: 'Preview: published campaign recap', status: 'published' as const, scheduledAt: null, publishedAt: day(-2), destinations: [[targets.north, 'published' as const], [targets.studio, 'published' as const]] },
    { id: `${FIXTURE}post_scheduled`, message: 'Preview: scheduled product launch', status: 'scheduled' as const, scheduledAt: day(2), publishedAt: null, destinations: [[targets.north, 'scheduled_remote' as const]] },
    { id: `${FIXTURE}post_draft`, message: 'Preview: draft waiting for review', status: 'draft' as const, scheduledAt: null, publishedAt: null, destinations: [[targets.north, 'pending' as const]] },
    { id: `${FIXTURE}post_approval`, message: 'Preview: seasonal offer awaiting approval', status: 'pending_approval', scheduledAt: null, publishedAt: null, destinations: [[targets.studio, 'pending']] },
    { id: `${FIXTURE}post_failed`, message: 'Preview: delivery failed and needs review', status: 'failed', scheduledAt: null, publishedAt: null, destinations: [[targets.north, 'failed']] },
    { id: `${FIXTURE}post_unselected`, message: 'Preview: post on unselected channel', status: 'published' as const, scheduledAt: null, publishedAt: day(-1), destinations: [[targets.hidden, 'published' as const]] },
  ];
  for (const post of postRows) {
    const firstComment = post.id === `${FIXTURE}post_draft` ? 'Preview: full offer details will appear in this first comment.' : null;
    const imageKey = post.id === `${FIXTURE}post_approval` ? 'studio' : 'market';
    const exampleMedia = images && post.id !== `${FIXTURE}post_failed` && post.id !== `${FIXTURE}post_unselected` ? [{ kind: 'image', url: images[imageKey], altText: PREVIEW_IMAGES[imageKey].altText }] : [];
    await prisma.post.upsert({ where: { id: post.id }, create: { id: post.id, workspaceId, authorId: userId, message: post.message, firstComment, link: null, media: exampleMedia, status: post.status, scheduledAt: post.scheduledAt, publishedAt: post.publishedAt, createdAt: stamp, updatedAt: stamp }, update: { message: post.message, firstComment, ...(images ? { media: exampleMedia } : {}), status: post.status, scheduledAt: post.scheduledAt, publishedAt: post.publishedAt, updatedAt: stamp } });
    for (const [targetId, status] of post.destinations) {
      const remotePostId = status === 'published' || status === 'scheduled_remote' ? `${FIXTURE}remote_${post.id}_${targetId}` : null;
      const id = `${post.id}_${targetId}`;
      await prisma.postTarget.upsert({ where: { postId_targetId: { postId: post.id, targetId } }, create: { id, postId: post.id, targetId, status, remotePostId, remoteUrl: null, publishedAt: status === 'published' ? post.publishedAt : null }, update: { status, remotePostId, publishedAt: status === 'published' ? post.publishedAt : null } });
    }
  }

  const metricRows = [
    [targets.north, 'page_follows', 'day', -1, 1280],
    [targets.studio, 'page_follows', 'day', -1, 740],
    [targets.north, 'page_daily_follows', 'day', -1, 16],
    [targets.studio, 'preview_unknown_demographic_breakdown', 'lifetime', -1, { '25-34|women': 41, '35-44|men': 23, Other: 8 }],
    [targets.hidden, 'page_follows', 'day', -1, 333],
  ] as const;
  for (const [targetId, metric, period, offset, raw] of metricRows) {
    const endTime = day(offset);
    const numeric = typeof raw === 'number' ? raw : null;
    const dateKey = endTime.toISOString().slice(0, 10).replaceAll('-', '');
    await prisma.pageInsight.upsert({ where: { targetId_metric_period_endTime: { targetId, metric, period, endTime } }, create: { id: `${FIXTURE}metric_${targetId}_${metric}_${dateKey}`, targetId, metric, period, endTime, value: raw, numeric, fetchedAt: stamp }, update: { value: raw, numeric, fetchedAt: stamp } });
  }

  const adRows = [
    [accounts.usd, 'campaign', 'Preview USD Campaign', -2, 135.25, 8400, 224, 5100, { actions: [{ action_type: 'purchase', value: 14 }, { action_type: 'preview_custom_conversion', value: 3 }], custom_breakdown: [{ label: 'North', value: 8 }, { label: 'South', value: 5 }] }],
    [accounts.usd, 'campaign', 'Preview USD Campaign', -1, 164.75, 10100, 289, 6200, { actions: [{ action_type: 'purchase', value: 17 }], preview_unknown_metric: 9 }],
    [accounts.eur, 'campaign', 'Preview EUR Campaign', -1, 92.4, 6300, 178, 3900, { actions: [{ action_type: 'lead', value: 11 }], audience_breakdown_preview: [{ country: 'MA', value: 7 }, { country: 'FR', value: 4 }] }],
    [accounts.unselected, 'campaign', 'Preview Unselected Campaign', -1, 40, 2800, 66, 1700, { actions: [{ action_type: 'preview_hidden_action', value: 5 }] }],
  ] as const;
  for (const [adAccountId, _level, objectName, offset, spend, impressions, clicks, reach, fields] of adRows) {
    const date = day(offset);
    const dateKey = date.toISOString().slice(0, 10).replaceAll('-', '');
    for (const level of ['account', 'campaign', 'adset', 'ad']) {
      const objectId = level === 'account' ? adAccountId : `${FIXTURE}${level}_${adAccountId}`;
      const name = level === 'account' ? accountRows.find(([id]) => id === adAccountId)![2] : level === 'campaign' ? objectName : `${objectName} · ${level === 'adset' ? 'Local audience' : 'Weekend creative'}`;
      const id = `${FIXTURE}insight_${adAccountId}_${level}_${dateKey}`;
      await prisma.adInsight.upsert({ where: { adAccountId_level_objectId_date: { adAccountId, level, objectId, date } }, create: { id, adAccountId, level, objectId, objectName: name, date, spend, impressions, clicks, reach, cpc: spend / clicks, cpm: spend / impressions * 1000, cpp: spend / reach, ctr: clicks / impressions * 100, frequency: impressions / reach, actions: fields.actions, fields, fetchedAt: stamp }, update: { objectName: name, spend, impressions, clicks, reach, cpc: spend / clicks, cpm: spend / impressions * 1000, cpp: spend / reach, ctr: clicks / impressions * 100, frequency: impressions / reach, actions: fields.actions, fields, fetchedAt: stamp } });
    }
  }

  const customerMessage = `${FIXTURE}customer`;
  const inboxThread = `${FIXTURE}conversation_open`;
  await prisma.conversation.upsert({
    where: { targetId_remoteId: { targetId: targets.north, remoteId: inboxThread } },
    create: { id: inboxThread, targetId: targets.north, remoteId: inboxThread, snippet: 'Could you share details about the weekend offer?', unreadCount: 1, messageCount: 2, participants: [{ id: customerMessage, name: 'Jordan Preview' }], updatedTime: new Date(now.getTime() - 10 * 60_000), fetchedAt: stamp },
    update: { snippet: 'Could you share details about the weekend offer?', unreadCount: 1, messageCount: 2, resolvedAt: null, updatedTime: new Date(now.getTime() - 10 * 60_000), fetchedAt: stamp },
  });
  const messages = [
    { remoteId: `${FIXTURE}message_earlier`, fromName: 'Jordan Preview', fromId: customerMessage, message: 'Hi, I saw your new collection.', createdTime: new Date(now.getTime() - 35 * 60_000) },
    { remoteId: `${FIXTURE}message_latest`, fromName: 'Jordan Preview', fromId: customerMessage, message: 'Could you share details about the weekend offer?', createdTime: new Date(now.getTime() - 10 * 60_000) },
  ];
  for (const message of messages) await prisma.conversationMessage.upsert({
    where: { conversationId_remoteId: { conversationId: inboxThread, remoteId: message.remoteId } },
    create: { id: message.remoteId, conversationId: inboxThread, ...message, firstSeenAt: stamp },
    update: { ...message },
  });
  const publishedPostTargetId = `${FIXTURE}post_published_${targets.north}`;
  const comments = [
    { remoteId: `${FIXTURE}comment_open`, parentRemoteId: null, message: 'This looks great. Is the offer available in store too?', fromName: 'Jordan Preview', fromId: customerMessage, isHidden: false, resolvedAt: null },
    { remoteId: `${FIXTURE}comment_reply`, parentRemoteId: `${FIXTURE}comment_open`, message: 'Yes, this offer is also available in store.', fromName: 'Preview North Market', fromId: targets.north, isHidden: false, resolvedAt: null },
    { remoteId: `${FIXTURE}comment_hidden`, parentRemoteId: null, message: 'Synthetic hidden comment for moderation preview.', fromName: 'Casey Preview', fromId: `${FIXTURE}customer_hidden`, isHidden: true, resolvedAt: stamp },
  ];
  for (const comment of comments) await prisma.postComment.upsert({
    where: { postTargetId_remoteId: { postTargetId: publishedPostTargetId, remoteId: comment.remoteId } },
    create: { id: comment.remoteId, postTargetId: publishedPostTargetId, ...comment, likeCount: 2, replyCount: comment.parentRemoteId ? 0 : 1, createdTime: new Date(now.getTime() - 15 * 60_000), fetchedAt: stamp, firstSeenAt: stamp },
    update: { ...comment, fetchedAt: stamp },
  });

  await preparePreviewInbox(prisma, { workspaceId, targetId: targets.studio, userId, now });

  console.log(`Seeded synthetic preview fixtures in ${workspaceId}. QA email: ${email}.`);
  console.log('Use the configured PREVIEW_QA_PASSWORD to sign in. No provider credentials are valid.');
}

main().catch((error: unknown) => {
  console.error('Preview seed failed:', error instanceof Error ? error.message : 'unknown error');
  process.exitCode = 1;
}).finally(async () => prisma.$disconnect());
