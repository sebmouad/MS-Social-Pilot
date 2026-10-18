import type { ReactNode } from 'react';
import { PageFrame } from '@/server/PageFrame';
import { TASKS_MODULE_ID } from '@/modules/tasks/semantics';

/** Tasks is a product module of its own: the shared shell supplies the module rail and the contextual sidebar the filters dock into. */
export default function TasksLayout({ children }: { children: ReactNode }) {
  return <PageFrame module={TASKS_MODULE_ID} scopedAccess>{children}</PageFrame>;
}
