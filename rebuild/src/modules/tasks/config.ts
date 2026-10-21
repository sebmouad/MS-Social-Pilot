import { z } from 'zod';
import { customerCopy, customerCopySchema } from './ui/copy';
import { entry } from '@/lib/config/entry';

/** Root-owned Tasks settings (prefix `tasks.`). Registered by the installed module host. */
export const TASKS_CONFIG = [
  entry({ key: 'tasks.customerCopy', group: 'Tasks', label: 'Customer copy', kind: 'json', description: 'English and French customer screen labels, feedback and empty states.', defaultValue: customerCopy, schema: customerCopySchema, consumption: 'active' }),
  entry({ key: 'tasks.titleMaxCharacters', group: 'Tasks', label: 'Task title limit', kind: 'number', description: 'Maximum characters in a task title.', defaultValue: 200, schema: z.number().int().min(1).max(1000), consumption: 'active' }),
  entry({ key: 'tasks.notesMaxCharacters', group: 'Tasks', label: 'Task notes limit', kind: 'number', description: 'Maximum characters in task notes.', defaultValue: 2000, schema: z.number().int().min(1).max(20000), consumption: 'active' }),
  entry({ key: 'tasks.commentMaxCharacters', group: 'Tasks', label: 'Task comment limit', kind: 'number', description: 'Maximum characters in one task comment. The database accepts at most 20,000.', defaultValue: 2000, schema: z.number().int().min(1).max(20000), consumption: 'active' }),
  entry({ key: 'tasks.pageLimit', group: 'Tasks', label: 'Task page size', kind: 'number', description: 'Maximum tasks returned in one page.', defaultValue: 100, schema: z.number().int().min(1).max(1000), consumption: 'active' }),
  entry({ key: 'tasks.commentHistoryLimit', group: 'Tasks', label: 'Task comment page size', kind: 'number', description: 'Maximum comments returned in one page for a task.', defaultValue: 200, schema: z.number().int().min(1).max(2000), consumption: 'active' }),
  entry({ key: 'tasks.assigneeLimit', group: 'Tasks', label: 'Assignable team limit', kind: 'number', description: 'Maximum active members offered as assignees.', defaultValue: 500, schema: z.number().int().min(1).max(5000), consumption: 'active' }),
  entry({ key: 'tasks.postChoiceLimit', group: 'Tasks', label: 'Linkable post choices', kind: 'number', description: 'Maximum posts offered per page when linking a task to a post.', defaultValue: 50, schema: z.number().int().min(1).max(500), consumption: 'active' }),
  entry({ key: 'tasks.workflowRowLimit', group: 'Tasks', label: 'Checklist length limit', kind: 'number', description: 'Maximum tasks created at once from a checklist.', defaultValue: 30, schema: z.number().int().min(1).max(200), consumption: 'active' }),
  entry({ key: 'tasks.workflowGapMaxDays', group: 'Tasks', label: 'Checklist day-gap limit', kind: 'number', description: 'Maximum days between consecutive due dates in a checklist.', defaultValue: 30, schema: z.number().int().min(0).max(3650), consumption: 'active' }),
  entry({ key: 'tasks.transactionTimeoutMs', group: 'Tasks', label: 'Task write timeout (ms)', kind: 'number', description: 'Maximum duration of one task write transaction.', defaultValue: 5000, schema: z.number().int().min(1000).max(60000), consumption: 'active' }),
  entry({ key: 'tasks.transactionMaxWaitMs', group: 'Tasks', label: 'Task write wait (ms)', kind: 'number', description: 'Maximum wait to start a task write transaction.', defaultValue: 500, schema: z.number().int().min(500).max(30000), consumption: 'active' }),
] as const;
