import { analyticsDateRange } from '@/modules/analytics/server/comparison';
import { OperationError } from '@/lib/operation-error';
import { createReportGenerator } from '@/modules/analytics/reports/generation/document';
import { registerReportGeneration, registeredReportPorts } from '@/modules/analytics/reports/generation/registry';
import { runDueReportSchedules } from '@/modules/analytics/reports/generation/runs';
import { reportLimits } from '@/modules/analytics/reports/server/limits';
import { listReportTemplates } from '@/modules/analytics/reports/server/templates';
import type { ReportActor, ReportMailInput } from '@/modules/analytics/reports/contracts';
import { runtimeConfig } from '@/server/config/store';
import { assertWorkspaceNotPurging } from '@/server/data-control/guard';
import { prisma } from '@/server/data';
import { assertWorkspaceJobAccess } from '@/server/jobs/access';
import { mailReady, sendTransactionalMail } from '@/server/mail';
import { selectedResourceConnectionWhere } from '@/server/platforms/resource-visibility';

/** Availability is honest about both transport and background execution. */
export async function reportDeliveryReady(): Promise<boolean> {
  try {
    const [delivery,jobs,smtp]=await Promise.all([runtimeConfig('analytics.reports.deliveryEnabled'),runtimeConfig('jobs.enabled'),mailReady()]);
    return delivery===true && jobs===true && smtp;
  } catch { return false; }
}

/** Application assembly only. Report rules stay in the Analytics module; provider
 * reads remain behind the shared Analytics reader and installed platform engines. */
export async function ensureReportWorkflows(): Promise<void> {
  if(registeredReportPorts()) return;
  const mail={
    ready:reportDeliveryReady,
    async send(input:ReportMailInput){
      if(!(await reportDeliveryReady())) return {status:'unavailable' as const};
      await assertWorkspaceNotPurging(input.workspaceId);
      // SMTP offers no idempotency contract. The report engine persists each
      // recipient intent first and holds ambiguous outcomes instead of resending.
      return sendTransactionalMail({to:input.to,subject:input.subject,text:input.text,html:input.html,workspaceId:input.workspaceId,template:'analytics_report'});
    },
  };
  registerReportGeneration({generation:createReportGenerator({bounds:async()=>{
    const limits=await reportLimits();return {maxRows:limits.maxRows,maxBytes:limits.maxBytes};
  }}),mail});
}

/** Same-owner qualification for report access AND this selected channel's provider. */
export async function reportJobEligible(workspaceId:string,channelId:string):Promise<boolean>{
  try{
    if(!(await reportDeliveryReady()))return false;
    await assertWorkspaceNotPurging(workspaceId);
    const workspace=await prisma.$queryRaw<Array<{id:string}>>`SELECT id FROM workspaces WHERE id = ${workspaceId} AND "suspendedAt" IS NULL`;
    if(!workspace.length)return false;
    const connection=await selectedResourceConnectionWhere(workspaceId);
    const target=await prisma.target.findFirst({where:{id:channelId,workspaceId,enabled:true,socialAccount:{is:connection}},select:{id:true,socialAccount:{select:{provider:true}}}});
    if(!target?.socialAccount?.provider)return false;
    await assertWorkspaceJobAccess(workspaceId,{provider:target.socialAccount.provider,anyFeatureOf:['analytics/reports']});
    return true;
  }catch{return false;}
}
export async function runScheduledReports(now=new Date()){
  await ensureReportWorkflows();
  return runDueReportSchedules({now,clock:()=>new Date(),eligible:reportJobEligible});
}

/** Manual windows use the same inclusive UTC calendar policy as Analytics. */
export async function reportDefaultPeriod(now=new Date()):Promise<{start:string;end:string;maxDays:number}>{
  try{
    const [defaultDays,maxDays]=await Promise.all([runtimeConfig('analytics.defaultRangeDays'),runtimeConfig('analytics.maxRangeDays')]);
    const period=analyticsDateRange({}, {defaultDays,maxDays,now});
    return {start:period.start,end:period.end,maxDays};
  }catch{throw new OperationError('unavailable','Report dates could not be loaded. Try again shortly.');}
}

/** Native selectors receive the complete authorized template set or a refusal,
 * never just the currently visible table page. No unbounded client fetch. */
export async function reportTemplateOptions(actor:ReportActor):Promise<Array<{id:string;name:string}>>{
  const limits=await reportLimits();
  const choices:Array<{id:string;name:string}>=[];
  const pageBound=Math.ceil(limits.maxTemplates/limits.pageSize)+1;
  for(let page=1;page<=pageBound;page++){
    const result=await listReportTemplates(actor,{page});
    choices.push(...result.templates.map(template=>({id:template.id,name:template.name})));
    if(choices.length>limits.maxTemplates)break;
    if(!result.hasMore)return choices;
  }
  throw new OperationError('unavailable','The report template choices could not be loaded completely. Try again shortly.');
}
