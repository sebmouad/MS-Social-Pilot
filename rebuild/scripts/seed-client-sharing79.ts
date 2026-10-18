/** Insert-only, explicitly opted-in examples in the existing synthetic preview workspace. Never contacts a provider. */
import { createHash, randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { PrismaClient } from '../generated/client';
import { sharingLimits } from '../src/modules/sharing/server/limits';
import { listShareableChannels } from '../src/modules/sharing/server/links';

async function main() {
  const u = new URL(process.env.DATABASE_URL || '');
  if (process.env.PREVIEW_SEED_CONFIRM !== 'SEED_LOCAL_CLIENT_SHARING' || process.env.NODE_ENV === 'production' || !['postgres:','postgresql:'].includes(u.protocol) || !['localhost','127.0.0.1','[::1]'].includes(u.hostname) || !u.pathname.endsWith('_preview') || ['host','hostaddr','socket'].some(k => u.searchParams.has(k))) throw Error('Explicit isolated preview required.');
  const db = new PrismaClient(), workspaceId = 'preview_workspace', userId = 'preview_qa_user';
  try {
    const member = await db.membership.findUnique({ where: { userId_workspaceId: { userId, workspaceId } }, include: { user: true, workspace: true } });
    if (member?.user.name !== 'Preview QA' || member.workspace.name !== 'Preview QA Workspace' || member.role !== 'owner') throw Error('Existing synthetic owner/workspace required.');
    const purge = await db.workspaceDataPurge.findUnique({ where: { workspaceId } });
    if (purge && purge.status !== 'completed') throw Error('Finish preview erasure first.');
    const limits = await sharingLimits();
    const channels = await listShareableChannels({ userId, workspaceId });
    const targetIds = channels.slice(0, limits.maxTargetsPerLink).map(channel => channel.id);
    if (!targetIds.length) throw Error('Existing enabled synthetic channels required.');
    const records = [
      ['preview_share_review', 'review', 'Autumn campaign review', 'Review the copy, images and first comment before launch.'],
      ['preview_share_calendar', 'calendar', 'Client publishing calendar', 'A shared view of planned and published campaign content.'],
      ['preview_share_portal', 'portal', 'Campaign client portal', 'Review upcoming content and check the publishing calendar.'],
    ] as const;
    const secretPaths: Record<string, string> = {};
    await db.$transaction(async tx => {
      const existing = await tx.$queryRaw<Array<{ id: string; workspaceId: string }>>`SELECT id,"workspaceId" FROM share_links WHERE id=ANY(${records.map(r => r[0])}::text[])`;
      if (existing.some(row => row.workspaceId !== workspaceId)) throw Error('Fixture identity collision.');
      for (const [id, kind, title, description] of records) {
        if (existing.some(row => row.id === id)) continue;
        const token = randomBytes(32).toString('base64url'), hash = createHash('sha256').update(token).digest('hex');
        await tx.$executeRaw`INSERT INTO share_links (id,"workspaceId",kind,"tokenHash",title,description,"targetIds","daysBack","daysAhead","allowComments",decides,"createdById","createdAt","expiresAt") VALUES (${id},${workspaceId},${kind},${hash},${title},${description},${JSON.stringify(targetIds)}::jsonb,${Math.min(7,limits.maxDaysBack)},${Math.min(30,limits.maxDaysAhead)},true,false,${userId},NOW(),${new Date(Date.now()+limits.defaultExpiryDays*86400000)})`;
        secretPaths[id] = `/share/${token}`;
      }
      const pages = await tx.$queryRaw<Array<{ id: string; workspaceId: string }>>`SELECT id,"workspaceId" FROM bio_pages WHERE id='preview_bio_page' OR slug='preview-studio' OR "workspaceId"=${workspaceId}`;
      if (pages.some(row => row.workspaceId !== workspaceId)) throw Error('Bio fixture identity collision.');
      if (!pages.length) {
        await tx.$executeRaw`INSERT INTO bio_pages (id,"workspaceId",slug,title,description,enabled,"createdAt","updatedAt") VALUES ('preview_bio_page',${workspaceId},'preview-studio','Studio Preview','Campaigns, projects and useful links from our team.',true,NOW(),NOW())`;
        for (const [id,label,url,sort,clicks] of [['preview_bio_campaign','Latest campaign','https://example.com/campaign',0,112],['preview_bio_services','Explore our services','https://example.com/services',1,34]] as const) await tx.$executeRaw`INSERT INTO bio_links (id,"pageId",label,url,position,clicks) VALUES (${id},'preview_bio_page',${label},${url},${sort},${clicks})`;
      }
    });
    if (Object.keys(secretPaths).length) await writeFile('/private/tmp/msp-preview-sharing-links.json', JSON.stringify(secretPaths), { mode: 0o600 });
    console.log('Synthetic sharing and bio examples inserted; existing edits preserved. New secret paths stay in a private local file.');
  } finally { await db.$disconnect(); }
}
main().catch(() => { console.error('Sharing preview seed refused or failed; details withheld.'); process.exitCode = 1; });
