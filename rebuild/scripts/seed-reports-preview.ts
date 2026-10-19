/** Insert-only examples in the existing synthetic workspace. No provider or mail call. */
import { PrismaClient } from '../generated/client';
import { ensureReportWorkflows, reportDefaultPeriod } from '@/modules/analytics/server/report-workflows';
import { runReportNow } from '../src/modules/analytics/reports/generation/runs';

async function main() {
  const url=new URL(process.env.DATABASE_URL ?? '');
  if(process.env.PREVIEW_SEED_CONFIRM!=='SEED_LOCAL_REPORTS' || process.env.NODE_ENV==='production' || !['postgres:','postgresql:'].includes(url.protocol) || !['localhost','127.0.0.1','[::1]'].includes(url.hostname) || !decodeURIComponent(url.pathname).endsWith('_preview') || ['host','hostaddr','socket'].some(key=>url.searchParams.has(key)))throw Error('Explicit isolated synthetic preview required.');
  const db=new PrismaClient(),workspaceId='preview_workspace',userId='preview_qa_user';
  try {
    const member=await db.membership.findUnique({where:{userId_workspaceId:{userId,workspaceId}},include:{user:true,workspace:true}});
    if(member?.user.name!=='Preview QA' || member.workspace.name!=='Preview QA Workspace' || member.role!=='owner')throw Error('Existing synthetic owner/workspace required.');
    const purge=await db.workspaceDataPurge.findUnique({where:{workspaceId}});
    if(purge && purge.status!=='completed')throw Error('Finish preview erasure first.');
    const channel=await db.target.findFirst({where:{workspaceId,enabled:true,socialAccount:{is:{workspaceId,invalidatedAt:null}}},orderBy:{id:'asc'},select:{id:true}});
    if(!channel)throw Error('An existing selected synthetic channel is required.');
    const ids=['preview_reports_weekly','preview_reports_audience','preview_reports_schedule'];
    await db.$transaction(async tx=>{
      const collisions=await tx.$queryRaw<Array<{workspaceId:string}>>`SELECT "workspaceId" FROM report_templates WHERE id=ANY(${ids}::text[]) UNION ALL SELECT "workspaceId" FROM report_schedules WHERE id=ANY(${ids}::text[])`;
      if(collisions.some(row=>row.workspaceId!==workspaceId))throw Error('Fixture identity collision.');
      await tx.$executeRaw`INSERT INTO report_templates (id,"workspaceId",name,sections,"rangeKey") VALUES ('preview_reports_weekly',${workspaceId},'Weekly performance','["analysis","audience","published"]'::jsonb,'7d'),('preview_reports_audience',${workspaceId},'Audience snapshot','["audience"]'::jsonb,'30d') ON CONFLICT DO NOTHING`;
      await tx.$executeRaw`INSERT INTO report_schedules (id,"workspaceId","templateId","targetId",frequency,recipients,"nextRunAt","aiRecap","createdById") VALUES ('preview_reports_schedule',${workspaceId},'preview_reports_weekly',${channel.id},'weekly',ARRAY['preview-reports@example.invalid']::text[],${new Date(Date.now()+45*86400000)},false,${userId}) ON CONFLICT DO NOTHING`;
    });
    const prior=await db.$queryRaw<Array<{id:string}>>`SELECT id FROM report_runs WHERE "workspaceId"=${workspaceId} AND "idempotencyKey"=${`manual:${workspaceId}:${userId}:ce9a6a90-8717-48f0-bf98-94a7d4ab67e1`}`;
    if(!prior.length){
      await ensureReportWorkflows();
      const period=await reportDefaultPeriod();
      await runReportNow({userId,workspaceId},{channelId:channel.id,templateId:'preview_reports_weekly',start:period.start,end:period.end,requestId:'ce9a6a90-8717-48f0-bf98-94a7d4ab67e1',confirmation:`GENERATE CHANNEL REPORT ${channel.id}`});
    }
    console.log('Synthetic report templates, future schedule and prepared history available; existing edits preserved. Nothing emailed.');
  } finally {await db.$disconnect();}
}
main().catch(()=>{console.error('Reports preview seed refused or failed; no credentials emitted.');process.exitCode=1;});
