import type { ModuleManifest } from '../types';

/** Tasks is its own product module: a workspace to-do board that can link posts. It has no background jobs. */
export const tasksManifest = {
  id: 'tasks',
  health: { configuration: true, jobHistory: true, pendingQueues: [] },
  jobs: [],
  rootSettingsPrefixes: ['tasks.'],
  rootSettingKeys: [],
  title: 'Tasks',
  href: '/tasks',
  pages: [
    { id: 'tasks/board', title: 'Tasks', href: '/tasks', description: 'Assign work, set due dates and follow progress with your team.' },
  ],
} as const satisfies ModuleManifest;
