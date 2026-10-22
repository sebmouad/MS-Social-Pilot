import { OperationError } from '@/lib/operation-error';
import { auditedReceipt, type McpToolGroup } from '@/server/mcp/kit';
import type { McpViewer } from '@/server/mcp/types';
import { aiMediaStatus, generateImage, generateVoice, listVideos, startVideo, IMAGE_CONFIRMATION, VIDEO_CONFIRMATION, VOICE_CONFIRMATION, type MediaActor } from './server/media';
import { engagementOutlook, linkPreview, spamCheck } from './server/checks';
import { POST_FORMATS } from './pure';

const FEATURE = 'publishing/posts';
const none = { type: 'object', properties: {}, additionalProperties: false } as const;
const local = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}$', description: 'Planned time as yyyy-MM-ddTHH:mm in the given time zone (default: the workspace time zone).' } as const;

export const contentToolDefinitions = [
  { name: 'get_ai_media_status', description: 'Report which AI picture, video and voice generation is available to this member, with the formats, voices, prompt limits, the exact confirmation each generation needs and this month’s estimated AI usage against the workspace budget.', inputSchema: none },
  { name: 'generate_ai_image', description: `Create one picture from a description and save it to the workspace media library. Counts toward the workspace hourly AI limit and monthly budget. Exact confirmation: ${IMAGE_CONFIRMATION}. Saves nothing else and publishes nothing.`, inputSchema: { type: 'object', required: ['prompt', 'confirmation'], properties: { prompt: { type: 'string', minLength: 1, maxLength: 4000 }, size: { type: 'string', maxLength: 32, description: 'A size id from get_ai_media_status.' }, confirmation: { type: 'string' } }, additionalProperties: false } },
  { name: 'generate_ai_voice', description: `Read a text aloud and return the audio as base64 (not stored). Counts toward the workspace hourly AI limit and monthly budget. Exact confirmation: ${VOICE_CONFIRMATION}.`, inputSchema: { type: 'object', required: ['text', 'confirmation'], properties: { text: { type: 'string', minLength: 1, maxLength: 20000 }, voice: { type: 'string', maxLength: 32, description: 'A voice from get_ai_media_status.' }, confirmation: { type: 'string' } }, additionalProperties: false } },
  { name: 'start_ai_video', description: `Start a short video from a description. It takes minutes; the finished file is saved to the media library and list_ai_videos shows its state. Counts toward the workspace hourly AI limit and monthly budget. Exact confirmation: ${VIDEO_CONFIRMATION}.`, inputSchema: { type: 'object', required: ['prompt', 'confirmation'], properties: { prompt: { type: 'string', minLength: 1, maxLength: 4000 }, aspectRatio: { type: 'string', maxLength: 8, description: 'A format id from get_ai_media_status.' }, confirmation: { type: 'string' } }, additionalProperties: false } },
  { name: 'list_ai_videos', description: 'List the workspace’s recent AI videos with their state (working, ready or failed). Videos still being made are checked with the provider first.', inputSchema: none },
  { name: 'get_link_preview', description: 'Fetch the title, description and picture of a public web address, as the composer shows them. Private and loopback addresses are refused; fetches are limited per workspace per hour.', inputSchema: { type: 'object', required: ['url'], properties: { url: { type: 'string', minLength: 1, maxLength: 4000 } }, additionalProperties: false } },
  { name: 'get_engagement_outlook', description: 'Compare a draft with one channel’s own past posts: above, around or below its usual, with the reasons. Advice from stored figures only; says unknown when the channel has too little history.', inputSchema: { type: 'object', required: ['targetId', 'format', 'length'], properties: { targetId: { type: 'string', maxLength: 200 }, format: { enum: [...POST_FORMATS] }, length: { type: 'integer', minimum: 0, maximum: 100000 }, scheduledAtLocal: local, timezone: { type: 'string', maxLength: 64 } }, additionalProperties: false } },
  { name: 'check_post_spam_risk', description: 'Check whether a post would put the same link or text on too many channels of one network within the workspace spacing window. Advice only; nothing is saved or blocked.', inputSchema: { type: 'object', required: ['targetIds'], properties: { message: { type: 'string', maxLength: 100000 }, link: { type: 'string', maxLength: 2000 }, targetIds: { type: 'array', minItems: 1, maxItems: 500, items: { type: 'string', maxLength: 200 } }, scheduledAtLocal: local, timezone: { type: 'string', maxLength: 64 }, postId: { type: 'string', maxLength: 200 } }, additionalProperties: false } },
] as const;

const actorOf = (viewer: McpViewer): MediaActor => ({ userId: viewer.userId, workspaceId: viewer.workspaceId, ...(viewer.permissions ? { permissionCeiling: viewer.permissions } : {}), ...(viewer.apiKeyId ? { apiKeyId: viewer.apiKeyId } : {}) });

export async function executeContentTool(viewer: McpViewer, name: string, args: Record<string, unknown>) {
  const actor = actorOf(viewer);
  switch (name) {
    case 'get_ai_media_status': return aiMediaStatus(actor);
    case 'generate_ai_image': { const r = await generateImage(actor, args); return auditedReceipt(viewer, name, { assetId: r.id, kind: 'image', size: r.size }, r); }
    case 'generate_ai_voice': {
      const r = await generateVoice(actor, args);
      return auditedReceipt(viewer, name, { kind: 'voice', bytes: r.bytes }, { mimeType: r.mimeType, bytes: r.bytes, audioBase64: r.audio.toString('base64') });
    }
    case 'start_ai_video': { const r = await startVideo(actor, args); return auditedReceipt(viewer, name, { videoId: r.id, kind: 'video' }, r); }
    case 'list_ai_videos': return listVideos(actor);
    case 'get_link_preview': return linkPreview(actor, args);
    case 'get_engagement_outlook': return engagementOutlook(actor, args);
    case 'check_post_spam_risk': return spamCheck(actor, args);
    default: throw new OperationError('invalid_request', 'Choose a supported AI action.');
  }
}

/**
 * MCP tool group for AI media generation and the composer checks. Generation saves into the workspace
 * media library and is therefore workspace-wide (a restricted-channel credential cannot use it); the
 * checks take channel ids and the service intersects them with the member's and the key's grants.
 */
export const AI_CONTENT_TOOLS_MCP: McpToolGroup = {
  id: 'ai-content-tools',
  tools: contentToolDefinitions,
  features: Object.fromEntries(contentToolDefinitions.map(tool => [tool.name, FEATURE])),
  writeTools: ['generate_ai_image', 'generate_ai_voice', 'start_ai_video'],
  selfLockedWrites: ['generate_ai_image', 'generate_ai_voice', 'start_ai_video'],
  scope: { workspaceTools: ['get_ai_media_status', 'generate_ai_image', 'generate_ai_voice', 'start_ai_video', 'list_ai_videos'], resourceTools: ['get_link_preview', 'get_engagement_outlook', 'check_post_spam_risk'] },
  execute: (viewer, name, args) => executeContentTool(viewer, name, args),
};
