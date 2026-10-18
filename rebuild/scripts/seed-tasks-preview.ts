/** Add synthetic examples only; preserve edited preview records. */
import { PrismaClient } from '../generated/client';
import { addCalendarDays } from '../src/modules/tasks/tasks';
async function main() {
  const u=new URL(process.env.DATABASE_URL||'');
  if(process.env.PREVIEW_SEED_CONFIRM!=='SEED_LOCAL_REBUILD_TASKS'||process.env.NODE_ENV==='production'||!['postgres:','postgresql:'].includes(u.protocol)||!['localhost','127.0.0.1','[::1]'].includes(u.hostname)||!u.pathname.endsWith('_preview')||['host','hostaddr','socket'].some(k=>u.searchParams.has(k)))throw Error('Explicit isolated preview required.');
  const db=new PrismaClient(),workspaceId='preview_workspace',userId='preview_qa_user';
  try {
    const member=await db.membership.findUnique({where:{userId_workspaceId:{userId,workspaceId}},include:{workspace:true,user:true}});
    if(member?.user.name!=='Preview QA'||member.workspace.name!=='Preview QA Workspace')throw Error('Existing synthetic preview required.');
    const purge=await db.workspaceDataPurge.findUnique({where:{workspaceId}});if(purge&&purge.status!=='completed')throw Error('Finish preview erasure first.');
    const today=new Intl.DateTimeFormat('en-CA',{timeZone:member.workspace.timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    const rows=[
      ['preview_task_review','Review the weekend campaign copy','Check the headline, first comment and destination previews.','todo',1,'preview_post_approval'],
      ['preview_task_media','Prepare launch photos and accessibility text','Choose the final images and add useful descriptions.','doing',2,'preview_post_draft'],
      ['preview_task_schedule','Confirm the product launch schedule','Check the workspace time zone and selected destinations.','todo',-1,'preview_post_scheduled'],
      ['preview_task_report','Share the weekly performance summary','Explain audience coverage and any missing reporting periods.','done',-2,null],
    ] as const;
    await db.$transaction(async tx=>{
      const existing=await tx.$queryRaw<Array<{workspaceId:string}>>`SELECT "workspaceId" FROM tasks WHERE id=ANY(${rows.map(x=>x[0])}::text[])`;
      if(existing.some(x=>x.workspaceId!==workspaceId))throw Error('Fixture identity collision.');
      for(const [id,title,notes,status,offset,postId] of rows){const post=postId?await tx.post.findFirst({where:{id:postId,workspaceId},select:{id:true}}):null;await tx.$executeRaw`INSERT INTO tasks (id,"workspaceId",title,notes,status,"assigneeId","dueOn","postId","createdById","createdAt","updatedAt") VALUES (${id},${workspaceId},${title},${notes},${status},${userId},${addCalendarDays(today,offset)},${post?.id??null},${userId},NOW(),NOW()) ON CONFLICT (id) DO NOTHING`;}
      await tx.$executeRaw`INSERT INTO task_comments (id,"taskId","workspaceId","authorId",body) VALUES ('preview_task_comment_review','preview_task_review',${workspaceId},${userId},'Draft is ready. Please check the first comment and destination previews.') ON CONFLICT (id) DO NOTHING`;
    });
    console.log('Added four realistic Tasks examples and one comment; existing edits retained.');
  }finally{await db.$disconnect();}
}
main().catch(()=>{console.error('Tasks preview seeding refused or failed; details withheld.');process.exitCode=1});
