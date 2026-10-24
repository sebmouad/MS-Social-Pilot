import { OperationError } from '@/lib/operation-error';
import { auditedReceipt, type McpToolGroup } from '@/server/mcp/kit';
import type { McpViewer } from '@/server/mcp/types';
import { learnCaptionTest, LEARN_FEATURE, LIST_FEATURE, listCaptionTests, listTestablePosts, START_CONFIRMATION, START_FEATURE, startCaptionTestInput, type CaptionActor } from './server/service';

export const captionTestToolDefinitions = [
  { name: 'list_caption_tests', description: 'List the workspace’s caption A/B tests with their state, per-caption views, engagements and engagement per view, and the winner or why there is none. With view "posts", list posts that could be put into a test instead. A member or key limited to some channels sees only tests that ran entirely on those channels.', inputSchema: { type: 'object', properties: { view: { enum: ['tests', 'posts'] } }, additionalProperties: false } },
  { name: 'start_caption_test', description: `Create draft posts from raw captions and targetIds (confirmation CREATE CAPTION TEST DRAFTS), or group two to four existing posts that carry the same content with different captions into a test; the first post becomes caption A. Results are compared after the chosen hours once the posts are published and measured. Exact confirmation: ${START_CONFIRMATION}.`, inputSchema: { type: 'object', required: ['confirmation'], properties: { captions: { type: 'array', items: { type: 'string' } }, targetIds: { type: 'array', items: { type: 'string' } }, link: { type: 'string' }, name: { type: 'string', maxLength: 300 }, hours: { type: 'integer', minimum: 1, maximum: 720 }, minViews: { type: 'integer', minimum: 1 }, postIds: { type: 'array', minItems: 2, maxItems: 4, items: { type: 'string', maxLength: 200 } }, confirmation: { type: 'string' } }, additionalProperties: false } },
  { name: 'learn_from_caption_test', description: 'Add a decided test’s winning caption, as one sentence, to the workspace writing voice used by AI assist. Refused when the test is undecided, already learned, or the voice would exceed its limit. Exact confirmation: LEARN <test id>.', inputSchema: { type: 'object', required: ['id', 'confirmation'], properties: { id: { type: 'string', maxLength: 200 }, confirmation: { type: 'string' } }, additionalProperties: false } },
] as const;

const actorOf = (viewer: McpViewer): CaptionActor => ({ userId: viewer.userId, workspaceId: viewer.workspaceId, ...(viewer.permissions ? { permissionCeiling: viewer.permissions } : {}), ...(viewer.apiKeyId ? { apiKeyId: viewer.apiKeyId } : {}) });

export async function executeCaptionTestTool(viewer: McpViewer, name: string, args: Record<string, unknown>) {
  const actor = actorOf(viewer);
  if (name === 'list_caption_tests') {
    if (args.view !== undefined && args.view !== 'tests' && args.view !== 'posts') throw new OperationError('invalid_request', 'Choose tests or posts.');
    return args.view === 'posts' ? { posts: await listTestablePosts(actor) } : listCaptionTests(actor);
  }
  if (name === 'start_caption_test') { const r = await startCaptionTestInput(actor, args); return auditedReceipt(viewer, name, { testId: r.id }, r); }
  if (name === 'learn_from_caption_test') { const r = await learnCaptionTest(actor, args); return auditedReceipt(viewer, name, { testId: String(args.id) }, r); }
  throw new OperationError('invalid_request', 'Choose a supported caption test action.');
}

/**
 * MCP tool group of caption tests. Listing and starting depend on channel access (the service intersects the key's
 * channels with the member's grants); learning changes workspace-wide writing and so needs a workspace-wide key.
 */
export const CAPTION_TESTS_MCP: readonly McpToolGroup[] = [{
  id: 'caption-tests',
  tools: captionTestToolDefinitions,
  features: { list_caption_tests: LIST_FEATURE, start_caption_test: START_FEATURE, learn_from_caption_test: LEARN_FEATURE },
  writeTools: ['start_caption_test', 'learn_from_caption_test'],
  selfLockedWrites: ['start_caption_test', 'learn_from_caption_test'],
  scope: { resourceTools: ['list_caption_tests', 'start_caption_test'], workspaceTools: ['learn_from_caption_test'] },
  execute: (viewer, name, args) => executeCaptionTestTool(viewer, name, args),
}];
