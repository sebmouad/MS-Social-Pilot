import { tasksManifest } from './manifest';

/**
 * Feature semantics the host mirrors in its shared entitlement and permission tables. Kept beside the
 * manifest so the service, tests and the host-integration notes read one definition.
 */
export const TASKS_MODULE_ID = tasksManifest.id;
export const TASKS_FEATURE_ID = tasksManifest.pages[0].id;

/** Workspace roles that may read and write tasks. Clients never see tasks. */
export const TASK_READ_ROLES: readonly string[] = ['owner', 'admin', 'editor', 'contributor', 'viewer'];
export const TASK_WRITE_ROLES: readonly string[] = ['owner', 'admin', 'editor', 'contributor'];
/** Roles that may change or delete any task; a contributor only the tasks they created or hold. */
export const TASK_MANAGER_ROLES: readonly string[] = ['owner', 'admin', 'editor'];
/** Roles that may remove any comment; everyone else only their own. */
export const TASK_COMMENT_MODERATOR_ROLES: readonly string[] = ['owner', 'admin'];

/** MCP tool -> required access, so the host gates discovery and calls on the same entitlement as the screen. */
export const TASKS_TOOL_ACCESS = {
  list_tasks: 'read', get_task: 'read', list_task_post_choices: 'read',
  create_task: 'write', create_task_checklist: 'write', update_task: 'write', move_task: 'write',
  delete_task: 'write', add_task_comment: 'write', delete_task_comment: 'write',
} as const;
