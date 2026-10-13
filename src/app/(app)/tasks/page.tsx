import { getTranslations } from 'next-intl/server';

import { ScreenHeader } from '@/components/ScreenHeader';
import { TasksClient } from '@/components/TasksClient';
import { requirePage } from '@/lib/auth';
import { screenMetadata } from '@/lib/metadata';
import { prisma } from '@/lib/prisma';
import { listTasks } from '@/lib/tasks';

export const dynamic = 'force-dynamic';

export function generateMetadata() {
  return screenMetadata('tasks.title');
}

/** The team's to-do board: to do, doing, done. */
export default async function TasksPage() {
  const auth = await requirePage();
  const t = await getTranslations('tasks');
  const [tasks, members] = await Promise.all([
    listTasks(auth.workspace.id),
    prisma.membership.findMany({
      where: { workspaceId: auth.workspace.id, role: { not: 'client' } },
      select: { user: { select: { id: true, name: true } } },
      orderBy: { user: { name: 'asc' } },
    }),
  ]);
  return (
    <div className="space-y-6">
      <ScreenHeader title={t('title')} subtitle={t('subtitle')} />
      <TasksClient
        key={`${auth.user.id}:${auth.workspace.id}`}
        canEdit={auth.role !== 'viewer'}
        myId={auth.user.id}
        members={members.map((member) => member.user)}
        tasks={tasks.map((task) => ({ id: task.id, title: task.title, notes: task.notes, status: task.status as 'todo' | 'doing' | 'done', assigneeId: task.assigneeId, dueOn: task.dueOn }))}
      />
    </div>
  );
}
