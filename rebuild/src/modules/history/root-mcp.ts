import { OperationError } from '@/lib/operation-error';
import { addRootChangelogEntry, listRootChangelog, removeRootChangelogEntry } from './server/changelog';

const privateNote = ' Installation owner only; workspace API keys cannot use this tool.';

/** Private Root MCP tools for the public changelog; merged by the Root MCP host (src/server/mcp/root-tools.ts). */
export const rootChangelogToolDefinitions = [
  { name: 'list_root_changelog', description: 'Public changelog entries, newest first, bounded by the Root page size.' + privateNote, inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'add_root_changelog_entry', description: 'Publish a changelog entry. Confirmation must exactly match ADD CHANGELOG ENTRY <trimmed title>. publishedOn is YYYY-MM-DD.' + privateNote, inputSchema: { type: 'object', required: ['publishedOn', 'title', 'confirmation'], properties: { publishedOn: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }, title: { type: 'string' }, body: { type: 'string' }, confirmation: { type: 'string' } }, additionalProperties: false } },
  { name: 'remove_root_changelog_entry', description: 'Permanently remove a changelog entry. Confirmation must exactly match REMOVE CHANGELOG ENTRY <id>.' + privateNote, inputSchema: { type: 'object', required: ['id', 'confirmation'], properties: { id: { type: 'string', minLength: 1 }, confirmation: { type: 'string' } }, additionalProperties: false } },
];
export const rootChangelogTools = new Set(rootChangelogToolDefinitions.map(tool => tool.name));
export const rootChangelogResources = [
  { uri: 'msp://root/changelog', name: 'Public changelog', description: 'Private view of the public What’s new entries.', tool: 'list_root_changelog' },
];

export async function executeRootChangelogTool(actorId: string, name: string, args: Record<string, unknown>, cap?: number) {
  switch (name) {
    case 'list_root_changelog':
      if (Object.keys(args).length) throw new OperationError('invalid_request', 'This read does not accept filters.');
      return listRootChangelog(actorId, cap);
    case 'add_root_changelog_entry': return addRootChangelogEntry(actorId, args);
    case 'remove_root_changelog_entry': {
      const { id, confirmation, ...extra } = args;
      if (Object.keys(extra).length) throw new OperationError('invalid_request', 'Choose an entry and enter the exact confirmation.');
      return removeRootChangelogEntry(actorId, id, confirmation);
    }
    default: throw new OperationError('not_found', 'Unknown tool.');
  }
}
