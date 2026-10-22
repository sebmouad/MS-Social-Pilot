import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { orderTablesForDeletion } from '../src/server/data-control/deletion-order';
import { inboxExportCoverage } from '../src/server/data-control/index';

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
    const schema = readFileSync(join(__dirname, '../prisma/legacy-schema.prisma'), 'utf8');
    for (const model of ['ModerationRule', 'ModerationAction', 'InboxNote', 'SavedReply']) {
      const block = schema.match(new RegExp(`model ${model} \\{[\\s\\S]*?\\n\\}`))?.[0] ?? '';
      expect(block, model).toMatch(/workspaceId\s+String/);
      expect(block, model).toMatch(/fields: \[workspaceId\], references: \[id\], onDelete: Cascade/);
    }
  });
});
