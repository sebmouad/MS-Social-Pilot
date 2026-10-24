import { describe, expect, it } from 'vitest';
import { orderTablesForDeletion } from '../src/server/data-control/deletion-order';
import { inboxExportCoverage } from '../src/server/data-control/index';
import { baselineSql } from './baseline-block';

const edge = (child: string, parent: string) => ({ child, parent });

describe('inbox export and erasure coverage', () => {
  it('reports every inbox table as included when the export reached it', () => {
    const coverage = inboxExportCoverage(new Set(['conversations', 'conversation_messages', 'page_reviews', 'inbox_notes', 'saved_replies', 'moderation_rules', 'moderation_actions']));
    expect(coverage.missing).toEqual([]);
    expect(coverage.included).toContainEqual({ table: 'moderation_actions', via: 'workspace' });
  });
  it('names a table the export did not reach instead of claiming it', () => {
    expect(inboxExportCoverage(new Set(['conversations'])).missing).toEqual(expect.arrayContaining(['moderation_rules', 'moderation_actions']));
  });
  it('erases moderation actions before the rules they reference', () => {
    const order = orderTablesForDeletion(['moderation_rules', 'moderation_actions', 'inbox_notes'], [edge('moderation_actions', 'moderation_rules')]);
    expect(order.indexOf('moderation_actions')).toBeLessThan(order.indexOf('moderation_rules'));
  });
  it('keeps every workspace-owned inbox table behind a cascading workspace foreign key', () => {
    const sql = baselineSql();
    for (const table of ['moderation_rules', 'moderation_actions', 'inbox_notes', 'saved_replies']) {
      const createBlock = sql.match(new RegExp(`CREATE TABLE "${table}" \\([\\s\\S]*?\\n\\);`))?.[0] ?? '';
      expect(createBlock, table).toMatch(/"workspaceId"\s+TEXT\s+NOT\s+NULL/);
      expect(sql, table).toContain(
        `ALTER TABLE "${table}" ADD CONSTRAINT "${table}_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;`
      );
    }
  });
});
