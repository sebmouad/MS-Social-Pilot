import { PrismaClient } from '../generated/client';
import { preparePreviewInbox } from './preview-inbox';
const prisma = new PrismaClient();
preparePreviewInbox(prisma, { workspaceId: 'preview_workspace', targetId: 'preview_target_studio', userId: 'preview_qa_user', now: new Date() })
  .then(result => console.log(JSON.stringify({ syntheticInboxExample: result })))
  .catch(() => { console.error('Inbox example seeding failed. Verify isolated preview configuration and reserved fixtures.'); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
