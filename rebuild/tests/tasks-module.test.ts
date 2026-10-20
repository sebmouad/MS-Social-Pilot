import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { tasksManifest } from '../src/modules/tasks/manifest';
import { TASKS_CONFIG } from '../src/modules/tasks/config';
import { TASKS_FEATURE_ID, TASKS_MODULE_ID, TASKS_TOOL_ACCESS, TASK_COMMENT_MODERATOR_ROLES, TASK_MANAGER_ROLES, TASK_READ_ROLES, TASK_WRITE_ROLES } from '../src/modules/tasks/semantics';
import { TASK_ACTION_SCHEMA, TASK_FILTER_SCHEMA, TASK_STATUSES, TASK_TRANSITIONS, addCalendarDays, taskConfirmations } from '../src/modules/tasks/tasks';
import { tasksToolDefinitions, tasksTools, tasksWriteTools } from '../src/modules/tasks/mcp';

const root = join(__dirname, '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const migrations = join(root, '..', 'prisma', 'migrations');
const MIGRATION = '20261025100000_rebuild_task_comments';

describe('Tasks manifest', () => {
  it('declares one self-contained product module with canonical routes and Root ownership', () => {
    expect(tasksManifest.id).toBe('tasks');
    expect(tasksManifest.href).toBe('/tasks');
    expect(tasksManifest.rootSettingsPrefixes).toEqual(['tasks.']);
    expect(tasksManifest.jobs).toEqual([]);
    const ids = tasksManifest.pages.map(page => page.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const page of tasksManifest.pages) { expect(page.id.startsWith('tasks/')).toBe(true); expect(page.href.startsWith('/tasks')).toBe(true); expect(page.href).not.toMatch(/^\/app/); }
    expect([TASKS_MODULE_ID, TASKS_FEATURE_ID]).toEqual(['tasks', 'tasks/board']);
  });
  it('keeps every Root key in the manifest namespace and consumes every setting', () => {
    const keys = TASKS_CONFIG.map(item => item.key);
    expect(new Set(keys).size).toBe(keys.length);
    const service = read('src/modules/tasks/server/tasks.ts');
    for (const entry of TASKS_CONFIG) {
      expect(tasksManifest.rootSettingsPrefixes.some(prefix => entry.key.startsWith(prefix))).toBe(true);
      expect(entry.schema.safeParse(entry.defaultValue).success).toBe(true);
      expect(entry.consumption).toBe('active');
      expect(service.includes(`'${entry.key}'`), `${entry.key} is declared but never read`).toBe(true);
    }
  });
  it('keeps the database comment ceiling equal to the largest configurable comment length', () => {
    const comment = TASKS_CONFIG.find(item => item.key === 'tasks.commentMaxCharacters')!;
    expect(comment.schema.safeParse(20000).success).toBe(true); expect(comment.schema.safeParse(20001).success).toBe(false);
    expect(read(`../prisma/migrations/${MIGRATION}/migration.sql`)).toContain('char_length("body") <= 20000');
  });
});

describe('Tasks semantics', () => {
  it('describes the role matrix the service enforces', () => {
    expect(TASK_READ_ROLES).toContain('viewer'); expect(TASK_WRITE_ROLES).not.toContain('viewer');
    for (const roles of [TASK_READ_ROLES, TASK_WRITE_ROLES, TASK_MANAGER_ROLES, TASK_COMMENT_MODERATOR_ROLES]) expect(roles).not.toContain('client');
    expect(TASK_MANAGER_ROLES.every(role => TASK_WRITE_ROLES.includes(role))).toBe(true);
  });
  it('exposes every tool with a declared access level and no undocumented tool', () => {
    expect([...tasksTools].sort()).toEqual(tasksToolDefinitions.map(tool => tool.name).sort());
    expect([...tasksWriteTools].sort()).toEqual(Object.entries(TASKS_TOOL_ACCESS).filter(([, access]) => access === 'write').map(([name]) => name).sort());
    const schemas = tasksToolDefinitions.map(tool => ({ name: tool.name, schema: tool.inputSchema as { additionalProperties?: boolean; required?: string[] } }));
    for (const { schema } of schemas) expect(schema.additionalProperties).toBe(false);
    for (const name of tasksWriteTools) expect(schemas.find(item => item.name === name)!.schema.required).toContain('confirmation');
  });
});

describe('Tasks contracts', () => {
  it('lets a task move between any two different statuses', () => {
    for (const from of TASK_STATUSES) expect([...TASK_TRANSITIONS[from]].sort()).toEqual(TASK_STATUSES.filter(status => status !== from).sort());
  });
  it('does calendar arithmetic without time zones and refuses dates outside the calendar', () => {
    expect(addCalendarDays('2026-12-30', 3)).toBe('2027-01-02');
    expect(addCalendarDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addCalendarDays('9999-12-31', 1)).toBeNull();
    expect(addCalendarDays('not-a-date', 1)).toBeNull();
  });
  it('validates action and filter shapes strictly', () => {
    expect(TASK_ACTION_SCHEMA.safeParse({ action: 'task.createMany', confirmation: 'CREATE 1 TASKS', titles: ['A'] })).toMatchObject({ success: true, data: { gapDays: 1 } });
    expect(TASK_ACTION_SCHEMA.safeParse({ action: 'task.createMany', confirmation: 'CREATE 0 TASKS', titles: [] }).success).toBe(false);
    expect(TASK_ACTION_SCHEMA.safeParse({ action: 'task.createMany', confirmation: 'CREATE 1 TASKS', titles: ['A'], gapDays: -1 }).success).toBe(false);
    expect(TASK_ACTION_SCHEMA.safeParse({ action: 'task.createMany', confirmation: 'CREATE 1 TASKS', titles: ['A'], workspaceId: 'x' }).success).toBe(false);
    expect(TASK_ACTION_SCHEMA.safeParse({ action: 'task.update', confirmation: 'UPDATE TASK t1', id: 't1', expectedUpdatedAt: 'yesterday' }).success).toBe(false);
    expect(TASK_FILTER_SCHEMA.safeParse({ assignee: 'me', overdue: true }).success).toBe(true);
    expect(TASK_FILTER_SCHEMA.safeParse({ workspaceId: 'w2' }).success).toBe(false);
    expect(taskConfirmations.createMany(3)).toBe('CREATE 3 TASKS');
  });
});

describe('Tasks comments migration', () => {
  const sql = read(`../prisma/migrations/${MIGRATION}/migration.sql`);
  it('sorts after every other migration and has a unique timestamp', () => {
    const names = readdirSync(migrations).filter(name => /^\d{14}_/.test(name));
    expect(names).toContain(MIGRATION);
    expect(names.filter(name => name.slice(0, 14) === MIGRATION.slice(0, 14))).toEqual([MIGRATION]);
    // It reuses the erasure write-gate function, so it must sort after the migration that creates it.
    expect(names.filter(name => name > MIGRATION && name.includes('task_comments'))).toEqual([]);
    expect(MIGRATION > '20261024100000_workspace_data_purges').toBe(true);
  });
  it('is additive: it creates objects and never drops, truncates or rewrites existing data', () => {
    const code = sql.split('\n').filter(line => !line.trim().startsWith('--')).join('\n')
      .replace(/ON (DELETE|UPDATE) (CASCADE|SET NULL)/gi, '').replace(/INSERT OR UPDATE/gi, '');
    expect(code).not.toMatch(/\b(DROP|TRUNCATE|DELETE|UPDATE|RENAME)\b/i);
    expect(code).not.toMatch(/ALTER TABLE "tasks"/i);
    expect(code).toContain('CREATE TABLE "task_comments"'); expect(code).toContain('CREATE UNIQUE INDEX "tasks_id_workspaceId_key" ON "tasks"("id", "workspaceId")');
  });
  it('keeps comments inside their task workspace and defines the data lifecycle', () => {
    expect(sql).toContain('FOREIGN KEY ("taskId", "workspaceId") REFERENCES "tasks"("id", "workspaceId") ON DELETE CASCADE');
    expect(sql).toContain('FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE');
    expect(sql).toContain('FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE SET NULL');
    expect(sql).toContain('"authorId" TEXT,');
    expect(sql).toContain('CHECK (char_length(btrim("body")) > 0');
  });
  it('indexes the ordered thread read and the author lookup, and joins the erasure write gate', () => {
    expect(sql).toContain('("taskId", "createdAt", "id")');
    expect(sql).toContain('"task_comments_authorId_idx"');
    expect(sql).toContain('CREATE TRIGGER rebuild_workspace_purge_write_gate BEFORE INSERT OR UPDATE ON "task_comments"');
    expect(sql).toContain('rebuild_reject_purging_workspace_write()');
    expect(readFileSync(join(migrations, '20261024100000_workspace_data_purges', 'migration.sql'), 'utf8')).toContain('CREATE FUNCTION rebuild_reject_purging_workspace_write()');
  });
  it('matches the columns the service reads and writes', () => {
    const service = read('src/modules/tasks/server/tasks.ts');
    for (const column of ['"id"', '"taskId"', '"workspaceId"', '"authorId"', '"body"', '"createdAt"']) expect(sql).toContain(`${column} `);
    expect(service).toContain('INSERT INTO task_comments (id, "taskId", "workspaceId", "authorId", body, "createdAt")');
  });
});
