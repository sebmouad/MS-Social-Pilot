import { getBestTimeSuggestions } from './server/best-time';
import { OperationError } from '@/lib/operation-error';
import { runtimeConfig } from '@/server/config/store';
import { cancelScheduledPost, importPostsCsv, publishPost, reschedulePostToInstant, reviewPost, schedulePost, submitPostForApproval, syncPostStatus } from '@/modules/publishing/server/lifecycle';
import { parseScheduleMode } from './remote-scheduling';
import { parseDestinationScheduleModes } from './server/schedule-modes';
import { queuePostRequest } from '@/modules/publishing/server/queue';
import { ensurePublishingCollaboration } from '@/modules/publishing/server/collaboration';
import { withMediaErrorBoundary } from '@/modules/publishing/server/media/mcp-errors';
import { deleteUnusedWorkspaceImage, getWorkspaceImageMetadata, listWorkspaceImages, uploadWorkspaceImage } from '@/modules/publishing/server/media/storage';
import { auditedReceipt, pageIdsFor, publishingActor, requireConfirmation, requiredString, type McpToolGroup } from '@/server/mcp/kit';
import { recordFirstCommentOutcome, retryFirstComment, sendFirstComment } from './server/first-comment';
import { finishPostDeletion, getPostDeletion, recordPostDeletionOutcome } from './server/deletion';
import { adoptLegacyPublication, finishPublicationProjection, getPublicationStatus, recordPublicationOutcome } from './server/publication';
import { duplicatePost } from './server/duplicate';
import { listPostsWithFirstComment } from './server/api';
import { exportPublishingPosts } from './server/export';
import { createPublishingPost, updatePublishingPost, deletePublishingPost } from './server/api-writes';
import { templateToolDefinitions, executeTemplateTool } from './template-mcp';
import { labelToolDefinitions, executeLabelTool } from './labels-mcp';
import { savedViewToolDefinitions, executeSavedViewTool } from './saved-views-mcp';
import { bulkToolDefinitions, executeBulkTool } from './bulk-mcp';
import { collaborationToolDefinitions, availableCollaborationTools, executeCollaborationTool } from './collaboration/mcp';

const destinationScheduleModesSchema = { type: 'object', additionalProperties: { type: 'string', enum: ['application', 'remote'] }, description: 'Optional per-destination override: destination ID to who holds its schedule. Destinations not listed follow scheduleMode (or the Root default).' };
const postMediaInputSchema = {
  type: 'array',
  description: 'Complete ordered attachment list. Image URLs may be HTTPS or workspace media references. Root and destination limits apply. Use this instead of imageUrl/videoUrl.',
  items: { type: 'object', required: ['kind', 'url'], properties: {
    kind: { type: 'string', enum: ['image', 'video'] }, url: { type: 'string' }, altText: { type: 'string' },
  }, additionalProperties: false },
};

/** Caption may be empty; the shared service requires usable post content. */
function isoInstant(value: unknown, key: string): Date {
  const date = new Date(String(value));
  if (typeof value !== 'string' || !Number.isFinite(date.getTime()) || !/^\d{4}-\d\d-\d\dT/.test(value)) throw new OperationError('invalid_request', `${key} must be an ISO date-time.`);
  return date;
}

/** MCP tool groups this module installs. The host merges installed groups; edit only here. */
export const PUBLISHING_MCP: readonly McpToolGroup[] = [
  {
    id: 'publishing-best-times',
    tools: [{ name: 'get_best_times', description: 'Suggest weekday/hour times from stored performance on every selected channel in the workspace time zone. Unknown or insufficient evidence returns no suggestions. Current publishing and analytics read access required.', inputSchema: { type: 'object', required: ['targetIds'], properties: { targetIds: { type: 'array', minItems: 1, uniqueItems: true, items: { type: 'string' } } }, additionalProperties: false } }],
    features: { get_best_times: 'publishing/posts' },
    scope: { resourceTools: ['get_best_times'] },
    execute: (viewer, _name, args) => getBestTimeSuggestions(publishingActor(viewer), args),
  },
  {
    id: 'publishing-templates',
    tools: templateToolDefinitions,
    features: {
      list_post_templates: 'publishing/templates',
      create_post_template: 'publishing/templates',
      update_post_template: 'publishing/templates',
      delete_post_template: 'publishing/templates',
    },
    writeTools: ['create_post_template', 'update_post_template', 'delete_post_template'],
    selfLockedWrites: ['create_post_template', 'update_post_template', 'delete_post_template'],
    scope: { workspaceTools: ['list_post_templates', 'create_post_template', 'update_post_template', 'delete_post_template'] },
    resources: [
      { uri: 'msp://publishing/templates', name: "Post templates", description: "Bounded workspace reusable templates. Continue pages with list_post_templates.", mimeType: 'application/json', feature: 'publishing/templates', readTool: 'list_post_templates' },
    ],
    execute: (viewer, name, args) => executeTemplateTool({ userId: viewer.userId, workspaceId: viewer.workspaceId }, name as Parameters<typeof executeTemplateTool>[1], args),
  },
  {
    id: 'publishing-labels',
    tools: labelToolDefinitions,
    features: {
      list_post_labels: 'publishing/labels',
      create_post_label: 'publishing/labels',
      update_post_label: 'publishing/labels',
      delete_post_label: 'publishing/labels',
    },
    writeTools: ['create_post_label', 'update_post_label', 'delete_post_label'],
    selfLockedWrites: ['create_post_label', 'update_post_label', 'delete_post_label'],
    scope: { workspaceTools: ['list_post_labels', 'create_post_label', 'update_post_label', 'delete_post_label'] },
    resources: [
      { uri: 'msp://publishing/labels', name: "Post labels", description: "Bounded workspace label directory. Continue pages with list_post_labels.", mimeType: 'application/json', feature: 'publishing/labels', readTool: 'list_post_labels' },
    ],
    execute: (viewer, name, args) => executeLabelTool({ userId: viewer.userId, workspaceId: viewer.workspaceId }, name as Parameters<typeof executeLabelTool>[1], args),
  },
  {
    id: 'publishing-saved-views',
    tools: savedViewToolDefinitions,
    features: {
      list_saved_views: 'publishing/posts',
      create_saved_view: 'publishing/posts',
      delete_saved_view: 'publishing/posts',
    },
    writeTools: ['create_saved_view', 'delete_saved_view'],
    selfLockedWrites: ['create_saved_view', 'delete_saved_view'],
    scope: { workspaceTools: ['list_saved_views', 'create_saved_view', 'delete_saved_view'] },
    execute: (viewer, name, args) => executeSavedViewTool({ userId: viewer.userId, workspaceId: viewer.workspaceId }, name, args),
  },
  {
    id: 'publishing-bulk',
    tools: bulkToolDefinitions,
    features: {
      bulk_post_action: 'publishing/posts',
    },
    writeTools: ['bulk_post_action'],
    selfLockedWrites: ['bulk_post_action'],
    scope: { workspaceTools: ['bulk_post_action'] },
    execute: (viewer, name, args) => executeBulkTool(publishingActor(viewer), name, args),
  },
  {
    id: 'publishing-collaboration',
    tools: collaborationToolDefinitions,
    features: {
      get_post_labels: 'publishing/collaboration',
      list_post_label_choices: 'publishing/collaboration',
      assign_post_labels: 'publishing/collaboration',
      list_custom_fields: 'publishing/collaboration',
      create_custom_field: 'publishing/collaboration',
      update_custom_field: 'publishing/collaboration',
      delete_custom_field: 'publishing/collaboration',
      get_post_field_values: 'publishing/collaboration',
      set_post_field_values: 'publishing/collaboration',
      list_post_notes: 'publishing/collaboration',
      add_post_note: 'publishing/collaboration',
      delete_post_note: 'publishing/collaboration',
      list_post_versions: 'publishing/collaboration',
      restore_post_version: 'publishing/collaboration',
      list_queue_times: 'publishing/queue',
      replace_queue_times: 'publishing/queue',
      get_content_mix: 'publishing/queue',
      save_content_mix: 'publishing/queue',
      set_content_mix_autofill: 'publishing/queue',
      get_post_recycle: 'publishing/collaboration',
      set_post_recycle: 'publishing/collaboration',
    },
    writeTools: ['assign_post_labels', 'create_custom_field', 'update_custom_field', 'delete_custom_field', 'set_post_field_values', 'add_post_note', 'delete_post_note', 'restore_post_version', 'replace_queue_times', 'save_content_mix', 'set_content_mix_autofill', 'set_post_recycle'],
    selfLockedWrites: ['assign_post_labels', 'create_custom_field', 'update_custom_field', 'delete_custom_field', 'set_post_field_values', 'add_post_note', 'delete_post_note', 'restore_post_version', 'replace_queue_times', 'save_content_mix', 'set_content_mix_autofill', 'set_post_recycle'],
    scope: { resourceTools: ['get_post_labels', 'assign_post_labels', 'get_post_field_values', 'set_post_field_values', 'list_post_notes', 'add_post_note', 'delete_post_note', 'list_post_versions', 'restore_post_version', 'get_post_recycle', 'set_post_recycle'], workspaceTools: ['list_post_label_choices', 'list_custom_fields', 'create_custom_field', 'update_custom_field', 'delete_custom_field', 'list_queue_times', 'replace_queue_times', 'get_content_mix', 'save_content_mix', 'set_content_mix_autofill'] },
    init: ensurePublishingCollaboration,
    available: async () => {
      const names = new Set<string>(availableCollaborationTools().map(tool => tool.name));
      return name => names.has(name);
    },
    resources: [
      { uri: 'msp://publishing/fields', name: "Custom post fields", description: "Complete bounded authorized workspace custom field definitions.", mimeType: 'application/json', feature: 'publishing/posts', readTool: 'list_custom_fields' },
    ],
    execute: (viewer, name, args, cap) => executeCollaborationTool({ userId: viewer.userId, workspaceId: viewer.workspaceId, allowedTargetIds: pageIdsFor(viewer) }, name, args, cap),
  },
  {
    id: 'publishing-media',
    tools: [
    { name: 'list_workspace_images', description: 'List bounded workspace image metadata. Image bytes remain in workspace storage and are not included.', inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 200 }, cursor: { type: 'string' } }, additionalProperties: false } },
    { name: 'get_workspace_image', description: 'Read metadata for one image stored in this workspace.', inputSchema: { type: 'object', required: ['imageId'], properties: { imageId: { type: 'string' } }, additionalProperties: false } },
    { name: 'delete_workspace_image', description: 'Permanently delete an unused workspace image. Images attached to posts cannot be deleted. Confirmation must exactly match DELETE WORKSPACE IMAGE <imageId>.', inputSchema: { type: 'object', required: ['imageId', 'confirmation'], properties: { imageId: { type: 'string' }, confirmation: { type: 'string' } }, additionalProperties: false } },
    { name: 'upload_workspace_image', description: 'Store a workspace image from standard base64 data. Root image MIME and byte limits apply. Confirmation must exactly match UPLOAD WORKSPACE IMAGE <fileName>.', inputSchema: { type: 'object', required: ['fileName', 'mimeType', 'base64', 'confirmation'], properties: { fileName: { type: 'string', minLength: 1, maxLength: 180 }, mimeType: { type: 'string' }, base64: { type: 'string' }, confirmation: { type: 'string' } }, additionalProperties: false } },
    ],
    features: {
      list_workspace_images: 'publishing/media',
      get_workspace_image: 'publishing/media',
      delete_workspace_image: 'publishing/media',
      upload_workspace_image: 'publishing/media',
    },
    writeTools: ['delete_workspace_image', 'upload_workspace_image'],
    scope: { workspaceTools: ['list_workspace_images', 'get_workspace_image', 'delete_workspace_image', 'upload_workspace_image'] },
    errorBoundary: { applies: () => true, wrap: withMediaErrorBoundary },
    resources: [
      { uri: 'msp://media/images', name: "Workspace images", description: "Bounded workspace image metadata; image bytes are excluded.", mimeType: 'application/json', feature: 'publishing/media', readTool: 'list_workspace_images', readArgs: { limit: 100 } },
    ],
    execute: async (viewer, name, args, cap) => {
      switch (name) {
      case 'list_workspace_images': {
        const limit = Math.max(1, Math.min(cap, 200, Math.trunc(Number(args.limit) || cap)));
        const cursor = args.cursor === undefined ? undefined : requiredString(args, 'cursor');
        return listWorkspaceImages(viewer.workspaceId, { limit, cursor });
      }
      case 'get_workspace_image':
        return getWorkspaceImageMetadata(viewer.workspaceId, requiredString(args, 'imageId'));
      case 'delete_workspace_image': {
        const imageId = requiredString(args, 'imageId');
        requireConfirmation(args, `DELETE WORKSPACE IMAGE ${imageId}`);
        const outcome = await deleteUnusedWorkspaceImage(viewer.workspaceId, imageId);
        if (outcome === 'in_use') throw new OperationError('conflict', 'This image is attached to a post and cannot be deleted.');
        if (outcome === 'missing') throw new OperationError('not_found', 'Image not found in this workspace.');
        return auditedReceipt(viewer, name, { imageId }, { imageId, deleted: true });
      }
      case 'upload_workspace_image': {
        const fileName = requiredString(args, 'fileName');
        const mimeType = requiredString(args, 'mimeType');
        const encoded = requiredString(args, 'base64');
        if (fileName.length > 180) throw new OperationError('invalid_request', 'fileName must contain at most 180 characters.');
        requireConfirmation(args, `UPLOAD WORKSPACE IMAGE ${fileName}`);
        const maxBytes = Number(await runtimeConfig('publishing.maxImageUploadBytes'));
        if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || encoded.length > Math.ceil(maxBytes / 3) * 4) throw new OperationError('invalid_request', 'This image exceeds the upload size limit.');
        if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) throw new OperationError('invalid_request', 'Image data must use standard padded base64.');
        const bytes = Buffer.from(encoded, 'base64');
        if (!bytes.length || bytes.length > maxBytes || bytes.toString('base64') !== encoded) throw new OperationError('invalid_request', 'Image data is empty, invalid, or exceeds the upload size limit.');
        const image = await uploadWorkspaceImage({ userId: viewer.userId, workspaceId: viewer.workspaceId }, new File([bytes], fileName, { type: mimeType }));
        return auditedReceipt(viewer, name, { imageId: image.id, mimeType: image.mimeType, size: bytes.length }, { ...image, size: bytes.length, reference: `media:${image.id}`, url: `/api/media/${image.id}` });
      }
        default: throw new OperationError('invalid_request', `Unknown tool: ${name}`);
      }
    },
  },
  {
    id: 'publishing-posts',
    tools: [
    { name: 'list_posts', description: 'List workspace posts, newest first. Filter by status, scheduled date and literal case-insensitive post text or first-comment search.', inputSchema: { type: 'object', properties: { status: { type: 'string', description: 'Comma-separated post statuses.' }, from: { type: 'string', description: 'ISO date or date-time lower bound for scheduledAt.' }, to: { type: 'string', description: 'ISO date or date-time upper bound for scheduledAt.' }, limit: { type: 'integer', minimum: 1 }, channelId: { type: 'string' }, q: { type: 'string', description: 'Literal search in post text and first comment.' }, origin: { type: 'string', description: 'Only posts created by an installed feature, for example recipe automation ("recipe").' } }, additionalProperties: false } },
    { name: 'export_posts', description: 'Prepare a UTF-8 CSV of all matching authorized posts with content, first comments, media, timestamps and destination delivery outcomes. Filter by one status, channel and literal text/first-comment search. Root export limits and the MCP result ceiling apply; oversized results are refused, never silently truncated. CSV cells are protected against spreadsheet formula execution. This is a read and sends no provider request.', inputSchema: { type: 'object', properties: { status: { type: 'string' }, channelId: { type: 'string' }, q: { type: 'string' } }, additionalProperties: false } },
    { name: 'create_draft', description: 'Create an unpublished local draft. Uses the same service as create_post with no destinations. Confirmation must be exactly CREATE POST.', inputSchema: { type: 'object', required: ['message', 'confirmation'], properties: { message: { type: 'string' }, confirmation: { type: 'string' } }, additionalProperties: false } },
    { name: 'update_draft', description: 'Alias for update_post: replace unpublished content and its complete destination list through the same service. Confirmation must be exactly UPDATE POST <postId>.', inputSchema: { type: 'object', required: ['postId', 'message', 'targetIds', 'confirmation'], properties: { postId: { type: 'string' }, message: { type: 'string' }, firstComment: { type: 'string' }, firstCommentDelayMinutes: { type: 'integer', minimum: 0 }, link: { type: 'string' }, media: postMediaInputSchema, destinationFormats: { type: 'object', additionalProperties: { type: 'string' } }, targetIds: { type: 'array', items: { type: 'string' } }, confirmation: { type: 'string' } }, additionalProperties: false } },
    { name: 'delete_draft', description: 'Alias for local post deletion through the shared deletion service. Returns its durable receipt. Confirmation must be exactly DELETE POST <postId> LOCAL.', inputSchema: { type: 'object', required: ['postId', 'confirmation'], properties: { postId: { type: 'string' }, confirmation: { type: 'string' } }, additionalProperties: false } },
    { name: 'publish_post', description: 'Publish a workspace post now to its configured destinations. This contacts social platforms. Confirmation must exactly match PUBLISH POST <postId>.', inputSchema: { type: 'object', required: ['postId', 'confirmation'], properties: { postId: { type: 'string' }, confirmation: { type: 'string' } }, additionalProperties: false } },
    { name: 'send_first_comment', description: 'Send the saved first comment once to a confirmed remote post. Recorded rejections require retry_first_comment instead. This contacts the platform. If the result is uncertain, inspect list_posts and do not repeat until the outcome has been manually checked. Confirmation must exactly match SEND FIRST COMMENT <postTargetId>.', inputSchema: { type: 'object', required: ['postId', 'postTargetId', 'confirmation'], properties: { postId: { type: 'string' }, postTargetId: { type: 'string' }, confirmation: { type: 'string' } }, additionalProperties: false } },
    { name: 'retry_first_comment', description: 'Deliberately retry one saved first comment only after a recorded definite rejection. Uncertain, legacy unknown, in-flight and sent comments are refused. Sends immediately, overriding the saved delay. Confirmation must exactly match RETRY FIRST COMMENT <postTargetId>.', inputSchema: { type: 'object', required: ['postId', 'postTargetId', 'confirmation'], properties: { postId: { type: 'string' }, postTargetId: { type: 'string' }, confirmation: { type: 'string' } }, additionalProperties: false } },
    { name: 'record_first_comment_outcome', description: 'Record an outcome verified manually on the platform. This tool does not contact or verify the platform. NOT SENT permits a separate later send request; SENT requires the platform comment ID. A late request may still appear. Confirmation must exactly match RECORD FIRST COMMENT <postTargetId> SENT or RECORD FIRST COMMENT <postTargetId> NOT SENT.', inputSchema: { type: 'object', required: ['postId', 'postTargetId', 'outcome', 'confirmation'], properties: { postId: { type: 'string' }, postTargetId: { type: 'string' }, outcome: { type: 'string', enum: ['sent', 'not_sent'] }, remoteId: { type: 'string', minLength: 1 }, confirmation: { type: 'string' } }, additionalProperties: false } },
    { name: 'sync_post_status', description: 'Refresh a post status from supported social platforms. Confirmation must exactly match SYNC POST STATUS <postId>.', inputSchema: { type: 'object', required: ['postId', 'confirmation'], properties: { postId: { type: 'string' }, confirmation: { type: 'string' } }, additionalProperties: false } },
    { name: 'delete_post', description: 'Start one post deletion request. Set deleteRemote to true to request remote deletion too. Inspect the returned per-destination receipt; uncertain results must be checked or manually attested before any separate retry. Confirmation must exactly match DELETE POST <postId> LOCAL or DELETE POST <postId> REMOTE.', inputSchema: { type: 'object', required: ['postId', 'deleteRemote', 'confirmation'], properties: { postId: { type: 'string' }, deleteRemote: { type: 'boolean' }, confirmation: { type: 'string' } }, additionalProperties: false } },
    { name: 'get_post_deletion_status', description: 'Read the current durable deletion receipt for a post, including after local removal.', inputSchema: { type: 'object', required: ['postId'], properties: { postId: { type: 'string' } }, additionalProperties: false } },
    { name: 'finish_post_deletion', description: 'Remove the local post only after every required remote deletion confirmation is persisted. Confirmation must exactly match FINISH POST DELETION <postId>.', inputSchema: { type: 'object', required: ['postId', 'confirmation'], properties: { postId: { type: 'string' }, confirmation: { type: 'string' } }, additionalProperties: false } },
    { name: 'record_post_deletion_outcome', description: 'Record an outcome manually verified on the platform. This does not contact or verify the platform; a late request may still take effect. Confirmation must exactly match RECORD POST DELETION <operationId> DELETED or RECORD POST DELETION <operationId> NOT DELETED.', inputSchema: { type: 'object', required: ['postId', 'operationId', 'outcome', 'verifiedOnPlatform', 'confirmation'], properties: { postId: { type: 'string' }, operationId: { type: 'string' }, outcome: { type: 'string', enum: ['deleted', 'not_deleted'] }, verifiedOnPlatform: { type: 'boolean', const: true }, confirmation: { type: 'string' } }, additionalProperties: false } },
    { name: 'get_publication_status', description: 'Read safe publication attempt and receipt state for one post.', inputSchema: { type: 'object', required: ['postId'], properties: { postId: { type: 'string' } }, additionalProperties: false } },
    { name: 'record_publication_outcome', description: 'Record a human external platform check for an uncertain publication. The app does not verify the platform; a delayed request may still complete. Confirmation must exactly match RECORD PUBLICATION <operationId> PUBLISHED or ABSENT.', inputSchema: { type: 'object', required: ['postId', 'operationId', 'outcome', 'verifiedExternally', 'confirmation'], properties: { postId: { type: 'string' }, operationId: { type: 'string' }, outcome: { type: 'string', enum: ['PUBLISHED', 'ABSENT'] }, remotePostId: { type: 'string' }, remoteUrl: { type: 'string' }, verifiedExternally: { type: 'boolean', const: true }, confirmation: { type: 'string' } }, additionalProperties: false } },
    { name: 'finish_publication_projection', description: 'Finish a saved publication receipt in local records only. Never sends another provider request. Confirmation must exactly match FINISH PUBLICATION <operationId>.', inputSchema: { type: 'object', required: ['postId', 'operationId', 'confirmation'], properties: { postId: { type: 'string' }, operationId: { type: 'string' }, confirmation: { type: 'string' } }, additionalProperties: false } },
    { name: 'adopt_legacy_publication', description: 'Adopt an older processing destination into recovery after checking its current platform state. This does not contact or verify the platform. Confirmation must exactly match ADOPT PUBLICATION <postTargetId>.', inputSchema: { type: 'object', required: ['postId', 'postTargetId', 'confirmation'], properties: { postId: { type: 'string' }, postTargetId: { type: 'string' }, confirmation: { type: 'string' } }, additionalProperties: false } },
    { name: 'duplicate_post', description: 'Copy an authorized post into one new unscheduled local draft with its content, first comment, media and selected destinations. Remote publications, schedules and delivery history are not copied. Use a new lowercase UUID as requestId; reuse that same UUID after an unconfirmed response to retrieve the existing draft. Confirmation must exactly match DUPLICATE POST <postId>.', inputSchema: { type: 'object', required: ['postId', 'requestId', 'confirmation'], properties: { postId: { type: 'string' }, requestId: { type: 'string', format: 'uuid' }, confirmation: { type: 'string' } }, additionalProperties: false } },
    { name: 'create_post', description: 'Create a local draft with selected destinations, first comment, optional delay in whole minutes, and an ordered media list with per-image descriptions. Use media instead of scalar imageUrl/videoUrl. message may be empty when a link or media supplies the post content; firstComment alone is insufficient. Root and selected destination rules apply. Confirmation must exactly match CREATE POST.', inputSchema: { type: 'object', required: ['message', 'targetIds', 'confirmation'], properties: { destinationFormats: { type: 'object', additionalProperties: { type: 'string' }, description: 'Selected destination ID to opaque format ID; omitted new destinations use their module default.' }, scheduledAt: { type: 'string', description: 'Optional future ISO timestamp; the post is then scheduled instead of kept as a draft.' }, scheduleMode: { type: 'string', enum: ['application', 'remote'], description: 'With scheduledAt: who holds the schedule. See schedule_post.' }, destinationScheduleModes: destinationScheduleModesSchema, message: { type: 'string' }, firstComment: { type: 'string' }, firstCommentDelayMinutes: { type: 'integer', minimum: 0 }, link: { type: 'string' }, media: postMediaInputSchema, imageUrl: { type: 'string' }, videoUrl: { type: 'string' }, targetIds: { type: 'array', items: { type: 'string' } }, confirmation: { type: 'string' } }, additionalProperties: false } },
    { name: 'update_post', description: 'Replace an unpublished post content and complete ordered media list. An empty media list removes attachments. Use media instead of scalar imageUrl/videoUrl; message may be empty with a link or media, but removing all content is refused. Optional firstCommentDelayMinutes is a whole number of minutes; Root bounds apply. Confirmation must exactly match UPDATE POST <postId>.', inputSchema: { type: 'object', required: ['postId', 'message', 'targetIds', 'confirmation'], properties: { destinationFormats: { type: 'object', additionalProperties: { type: 'string' }, description: 'Selected destination ID to opaque format ID; omitted existing choices are preserved.' }, postId: { type: 'string' }, message: { type: 'string' }, firstComment: { type: 'string' }, firstCommentDelayMinutes: { type: 'integer', minimum: 0 }, link: { type: 'string' }, media: postMediaInputSchema, imageUrl: { type: 'string' }, videoUrl: { type: 'string' }, targetIds: { type: 'array', items: { type: 'string' } }, confirmation: { type: 'string' } }, additionalProperties: false } },
    { name: 'submit_post_for_approval', description: 'Submit a draft for review. Confirmation must exactly match SUBMIT POST <postId>.', inputSchema: { type: 'object', required: ['postId', 'confirmation'], properties: { postId: { type: 'string' }, confirmation: { type: 'string' } }, additionalProperties: false } },
    { name: 'review_post', description: 'Approve or reject a pending post. Confirmation must exactly match APPROVE POST <postId> or REJECT POST <postId>.', inputSchema: { type: 'object', required: ['postId', 'decision', 'confirmation'], properties: { postId: { type: 'string' }, decision: { type: 'string', enum: ['approve', 'reject'] }, confirmation: { type: 'string' } }, additionalProperties: false } },
    { name: 'queue_post', description: 'Assign a local draft to the next free saved queue time for all its destinations, in the workspace time zone. Required approvals still apply; no immediate publication. Platform-held destinations (per scheduleMode / destinationScheduleModes, else the Root default) are handed to their platform once the time is saved; the result lists remoteHold. Confirmation must exactly match QUEUE POST <postId>.', inputSchema: { type: 'object', required: ['postId', 'confirmation'], properties: { postId: { type: 'string' }, scheduleMode: { type: 'string', enum: ['application', 'remote'] }, destinationScheduleModes: destinationScheduleModesSchema, confirmation: { type: 'string' } }, additionalProperties: false } },
    { name: 'schedule_post', description: 'Schedule a draft for a future ISO timestamp. scheduleMode "application" (default unless Root changed it) has this app publish at the time; "remote" asks each destination\'s platform to hold and publish it itself, even if this app is offline, for destinations that support it within their allowed lead time. Others stay with the app; the result lists remoteHold {held, deferred, reasons}. Confirmation must exactly match SCHEDULE POST <postId> <timestamp>.', inputSchema: { type: 'object', required: ['postId', 'scheduledAt', 'confirmation'], properties: { postId: { type: 'string' }, scheduledAt: { type: 'string' }, scheduleMode: { type: 'string', enum: ['application', 'remote'] }, destinationScheduleModes: destinationScheduleModesSchema, confirmation: { type: 'string' } }, additionalProperties: false } },
    { name: 'reschedule_post', description: 'Move a scheduled post to a new future ISO timestamp. A destination whose platform is holding the post is moved on the platform first; if it cannot hold the new time nothing changes and you are told to pick another time or cancel. Confirmation must exactly match RESCHEDULE POST <postId> <timestamp>.', inputSchema: { type: 'object', required: ['postId', 'scheduledAt', 'confirmation'], properties: { postId: { type: 'string' }, scheduledAt: { type: 'string' }, confirmation: { type: 'string' } }, additionalProperties: false } },
    { name: 'import_posts', description: 'Create draft posts from CSV text with header message,firstComment,channels and optional destinationFormats,firstCommentDelayMinutes. Root row and size limits apply; nothing is published. Confirmation must exactly match IMPORT POSTS.', inputSchema: { type: 'object', required: ['csv', 'confirmation'], properties: { csv: { type: 'string' }, confirmation: { type: 'string' } }, additionalProperties: false } },
    { name: 'cancel_scheduled_post', description: 'Return a queued post to drafts before delivery. A copy held by the platform is removed from the platform first (only while it is still scheduled there). Confirmation must exactly match CANCEL SCHEDULE <postId>.', inputSchema: { type: 'object', required: ['postId', 'confirmation'], properties: { postId: { type: 'string' }, confirmation: { type: 'string' } }, additionalProperties: false } },
    ],
    features: {
      list_posts: 'publishing/posts',
      export_posts: 'publishing/posts',
      create_draft: 'publishing/posts',
      update_draft: 'publishing/posts',
      delete_draft: 'publishing/posts',
      publish_post: 'publishing/posts',
      send_first_comment: 'publishing/posts',
      retry_first_comment: 'publishing/posts',
      record_first_comment_outcome: 'publishing/posts',
      sync_post_status: 'publishing/posts',
      delete_post: 'publishing/posts',
      get_post_deletion_status: 'publishing/posts',
      finish_post_deletion: 'publishing/posts',
      record_post_deletion_outcome: 'publishing/posts',
      get_publication_status: 'publishing/posts',
      record_publication_outcome: 'publishing/posts',
      finish_publication_projection: 'publishing/posts',
      adopt_legacy_publication: 'publishing/posts',
      duplicate_post: 'publishing/posts',
      create_post: 'publishing/posts',
      update_post: 'publishing/posts',
      submit_post_for_approval: 'publishing/posts',
      review_post: 'publishing/approvals',
      queue_post: 'publishing/queue',
      schedule_post: 'publishing/posts',
      cancel_scheduled_post: 'publishing/posts',
      reschedule_post: 'publishing/posts',
      import_posts: 'publishing/posts',
    },
    writeTools: ['import_posts', 'create_draft', 'update_draft', 'delete_draft', 'publish_post', 'send_first_comment', 'retry_first_comment', 'record_first_comment_outcome', 'sync_post_status', 'delete_post', 'finish_post_deletion', 'record_post_deletion_outcome', 'record_publication_outcome', 'finish_publication_projection', 'adopt_legacy_publication', 'duplicate_post', 'create_post', 'update_post', 'submit_post_for_approval', 'review_post', 'queue_post', 'schedule_post', 'cancel_scheduled_post', 'reschedule_post'],
    selfLockedWrites: ['import_posts', 'create_draft', 'update_draft', 'delete_draft', 'publish_post', 'send_first_comment', 'retry_first_comment', 'record_first_comment_outcome', 'sync_post_status', 'delete_post', 'finish_post_deletion', 'record_post_deletion_outcome', 'record_publication_outcome', 'finish_publication_projection', 'adopt_legacy_publication', 'duplicate_post', 'create_post', 'update_post', 'submit_post_for_approval', 'review_post', 'queue_post', 'schedule_post', 'cancel_scheduled_post', 'reschedule_post'],
    scope: { resourceTools: ['list_posts', 'export_posts', 'publish_post', 'send_first_comment', 'retry_first_comment', 'record_first_comment_outcome', 'sync_post_status', 'delete_post', 'get_post_deletion_status', 'finish_post_deletion', 'record_post_deletion_outcome', 'get_publication_status', 'record_publication_outcome', 'finish_publication_projection', 'adopt_legacy_publication', 'duplicate_post', 'create_post', 'update_post', 'submit_post_for_approval', 'review_post', 'queue_post', 'schedule_post', 'cancel_scheduled_post', 'reschedule_post'], workspaceTools: ['import_posts', 'create_draft', 'update_draft', 'delete_draft'], resources: ['msp://posts'] },
    resources: [
      { uri: 'msp://posts', name: "Posts", description: "Recent workspace posts.", mimeType: 'application/json', feature: 'publishing/posts', readTool: 'list_posts', readArgs: { limit: 100 } },
    ],
    execute: async (viewer, name, args, cap) => {
      switch (name) {
      case 'list_posts': {
        return listPostsWithFirstComment({ userId: viewer.userId, workspaceId: viewer.workspaceId, ...(pageIdsFor(viewer) === undefined ? {} : { allowedTargetIds: pageIdsFor(viewer) }) }, args, cap);
      }
      case 'export_posts': {
        return exportPublishingPosts({ userId: viewer.userId, workspaceId: viewer.workspaceId, ...(pageIdsFor(viewer) === undefined ? {} : { allowedTargetIds: pageIdsFor(viewer) }) }, args, {
          maxItems: viewer.maxResultItems ?? await runtimeConfig('mcp.maxResultItems'),
        });
      }
      case 'publish_post': {
        const postId = typeof args.postId === 'string' ? args.postId : '';
        if (!postId) throw new OperationError('invalid_request', 'postId is required.');
        requireConfirmation(args, `PUBLISH POST ${postId}`);
        const result = await publishPost(publishingActor(viewer), postId);
        return auditedReceipt(viewer, name, { postId, ...result }, { postId, ...result });
      }
      case 'send_first_comment': {
        const postId = requiredString(args, 'postId');
        const postTargetId = requiredString(args, 'postTargetId');
        if (Object.keys(args).some(key => !['postId', 'postTargetId', 'confirmation'].includes(key))) throw new OperationError('invalid_request', 'Choose one post destination.');
        requireConfirmation(args, `SEND FIRST COMMENT ${postTargetId}`);
        const result = await sendFirstComment(publishingActor(viewer), { postId, postTargetId });
        return auditedReceipt(viewer, name, { postId, postTargetId, state: result.state }, result);
      }
      case 'retry_first_comment': {
        const postId = requiredString(args, 'postId');
        const postTargetId = requiredString(args, 'postTargetId');
        requireConfirmation(args, `RETRY FIRST COMMENT ${postTargetId}`);
        const result = await retryFirstComment(publishingActor(viewer), args);
        return auditedReceipt(viewer, name, { postId, postTargetId, state: result.state }, result);
      }
      case 'record_first_comment_outcome': {
        const postId = requiredString(args, 'postId');
        const postTargetId = requiredString(args, 'postTargetId');
        const outcome = args.outcome;
        if (outcome !== 'sent' && outcome !== 'not_sent') throw new OperationError('invalid_request', 'outcome must be sent or not_sent.');
        if (Object.keys(args).some(key => !['postId', 'postTargetId', 'outcome', 'remoteId', 'confirmation'].includes(key))) throw new OperationError('invalid_request', 'Choose one verified comment outcome.');
        const remoteId = typeof args.remoteId === 'string' ? args.remoteId.trim() : '';
        if (outcome === 'sent' && !remoteId) throw new OperationError('invalid_request', 'remoteId is required when outcome is sent.');
        if (outcome === 'not_sent' && remoteId) throw new OperationError('invalid_request', 'Do not include remoteId when outcome is not_sent.');
        const confirmation = `RECORD FIRST COMMENT ${postTargetId} ${outcome === 'sent' ? 'SENT' : 'NOT SENT'}`;
        requireConfirmation(args, confirmation);
        const result = await recordFirstCommentOutcome(publishingActor(viewer), { postId, postTargetId, outcome, ...(remoteId ? { remoteId } : {}), confirmation });
        return auditedReceipt(viewer, name, { postId, postTargetId, outcome, state: result.state }, result);
      }
      case 'sync_post_status': {
        const postId = typeof args.postId === 'string' ? args.postId : '';
        if (!postId) throw new OperationError('invalid_request', 'postId is required.');
        requireConfirmation(args, `SYNC POST STATUS ${postId}`);
        const result = await syncPostStatus(publishingActor(viewer), postId);
        return auditedReceipt(viewer, name, { postId, ...result }, { postId, ...result });
      }
      case 'delete_draft':
      case 'delete_post': {
        const postId = requiredString(args, 'postId');
        const input = name === 'delete_draft' ? { ...args, deleteRemote: false } : args;
        const result = await deletePublishingPost(publishingActor(viewer), postId, input);
        return auditedReceipt(viewer, name, { postId, remoteDeletionRequested: input.deleteRemote, state: result.state }, result);
      }
      case 'get_post_deletion_status': {
        const postId = requiredString(args, 'postId');
        if (Object.keys(args).some(key => key !== 'postId')) throw new OperationError('invalid_request', 'postId is the only accepted field.');
        return getPostDeletion(publishingActor(viewer), { postId });
      }
      case 'finish_post_deletion': {
        const postId = requiredString(args, 'postId');
        if (Object.keys(args).some(key => !['postId', 'confirmation'].includes(key))) throw new OperationError('invalid_request', 'postId and confirmation are the only accepted fields.');
        requireConfirmation(args, `FINISH POST DELETION ${postId}`);
        const result = await finishPostDeletion(publishingActor(viewer), { postId, confirmation: `FINISH POST DELETION ${postId}` });
        return auditedReceipt(viewer, name, { postId, state: result.state }, result);
      }
      case 'record_post_deletion_outcome': {
        const postId = requiredString(args, 'postId');
        const operationId = requiredString(args, 'operationId');
        const outcome = args.outcome;
        if (outcome !== 'deleted' && outcome !== 'not_deleted') throw new OperationError('invalid_request', 'outcome must be deleted or not_deleted.');
        if (args.verifiedOnPlatform !== true) throw new OperationError('invalid_request', 'verifiedOnPlatform must be true after an external platform check.');
        if (Object.keys(args).some(key => !['postId', 'operationId', 'outcome', 'verifiedOnPlatform', 'confirmation'].includes(key))) throw new OperationError('invalid_request', 'Only the post, operation and verified outcome are accepted.');
        requireConfirmation(args, `RECORD POST DELETION ${operationId} ${outcome === 'deleted' ? 'DELETED' : 'NOT DELETED'}`);
        const result = await recordPostDeletionOutcome(publishingActor(viewer), { postId, operationId, outcome, confirmation: `RECORD POST DELETION ${operationId} ${outcome === 'deleted' ? 'DELETED' : 'NOT DELETED'}`, verifiedOnPlatform: true });
        return auditedReceipt(viewer, name, { postId, operationId, outcome, state: result.state }, result);
      }
      case 'get_publication_status': {
        const postId = requiredString(args, 'postId');
        if (Object.keys(args).some(key => key !== 'postId')) throw new OperationError('invalid_request', 'postId is the only accepted field.');
        return getPublicationStatus(publishingActor(viewer), { postId });
      }
      case 'record_publication_outcome': {
        const postId = requiredString(args, 'postId');
        const operationId = requiredString(args, 'operationId');
        const outcome = args.outcome;
        if (outcome !== 'PUBLISHED' && outcome !== 'ABSENT' || args.verifiedExternally !== true) throw new OperationError('invalid_request', 'Choose a valid outcome after an external platform check.');
        if (Object.keys(args).some(key => !['postId', 'operationId', 'outcome', 'remotePostId', 'remoteUrl', 'verifiedExternally', 'confirmation'].includes(key))) throw new OperationError('invalid_request', 'Only the post, operation, receipt and verified outcome are accepted.');
        requireConfirmation(args, `RECORD PUBLICATION ${operationId} ${outcome}`);
        const result = await recordPublicationOutcome(publishingActor(viewer), { postId, operationId, outcome, ...(typeof args.remotePostId === 'string' ? { remotePostId: args.remotePostId } : {}), ...(typeof args.remoteUrl === 'string' ? { remoteUrl: args.remoteUrl } : {}), confirmation: `RECORD PUBLICATION ${operationId} ${outcome}`, verifiedExternally: true });
        return auditedReceipt(viewer, name, { postId, operationId, outcome }, result);
      }
      case 'finish_publication_projection': {
        const postId = requiredString(args, 'postId'); const operationId = requiredString(args, 'operationId');
        if (Object.keys(args).some(key => !['postId', 'operationId', 'confirmation'].includes(key))) throw new OperationError('invalid_request', 'Only the post, operation and confirmation are accepted.');
        requireConfirmation(args, `FINISH PUBLICATION ${operationId}`);
        const result = await finishPublicationProjection(publishingActor(viewer), { postId, operationId, confirmation: `FINISH PUBLICATION ${operationId}` });
        return auditedReceipt(viewer, name, { postId, operationId }, result);
      }
      case 'adopt_legacy_publication': {
        const postId = requiredString(args, 'postId'); const postTargetId = requiredString(args, 'postTargetId');
        if (Object.keys(args).some(key => !['postId', 'postTargetId', 'confirmation'].includes(key))) throw new OperationError('invalid_request', 'Only the post, destination and confirmation are accepted.');
        requireConfirmation(args, `ADOPT PUBLICATION ${postTargetId}`);
        const result = await adoptLegacyPublication(publishingActor(viewer), { postId, postTargetId, confirmation: `ADOPT PUBLICATION ${postTargetId}` });
        return auditedReceipt(viewer, name, { postId, postTargetId }, result);
      }
      case 'duplicate_post': {
        const postId = requiredString(args, 'postId');
        requireConfirmation(args, `DUPLICATE POST ${postId}`);
        const result = await duplicatePost(publishingActor(viewer), args);
        return auditedReceipt(viewer, name, { sourcePostId: result.sourcePostId, postId: result.postId, replayed: result.replayed }, result);
      }
      case 'create_draft':
      case 'create_post': {
        const input = name === 'create_draft' ? { ...args, targetIds: [] } : args;
        const result = await createPublishingPost(publishingActor(viewer), input);
        return auditedReceipt(viewer, name, { postId: result.id }, result);
      }
      case 'update_draft':
      case 'update_post': {
        const postId = requiredString(args, 'postId');
        const result = await updatePublishingPost(publishingActor(viewer), postId, args);
        return auditedReceipt(viewer, name, { postId }, result);
      }
      case 'submit_post_for_approval': {
        const postId = requiredString(args, 'postId');
        requireConfirmation(args, `SUBMIT POST ${postId}`);
        await submitPostForApproval(publishingActor(viewer), postId);
        return auditedReceipt(viewer, name, { postId }, { postId, status: 'pending_approval' });
      }
      case 'review_post': {
        const postId = requiredString(args, 'postId');
        if (args.decision !== 'approve' && args.decision !== 'reject') throw new OperationError('invalid_request', 'decision must be approve or reject.');
        requireConfirmation(args, `${args.decision.toUpperCase()} POST ${postId}`);
        await reviewPost(publishingActor(viewer), postId, args.decision);
        return auditedReceipt(viewer, name, { postId, decision: args.decision }, { postId, decision: args.decision });
      }
      case 'queue_post': {
        const outcome = await queuePostRequest({ userId: viewer.userId, workspaceId: viewer.workspaceId, allowedTargetIds: pageIdsFor(viewer) }, args);
        return auditedReceipt(viewer, name, { postId: outcome.postId, scheduledAt: outcome.scheduledAt.toISOString(), status: outcome.status, scheduleMode: outcome.scheduleMode }, { postId: outcome.postId, scheduledAt: outcome.scheduledAt.toISOString(), status: outcome.status, scheduleMode: outcome.scheduleMode, destinationScheduleModes: outcome.destinationScheduleModes, remoteHold: outcome.remoteHold });
      }
      case 'schedule_post': {
        const postId = requiredString(args, 'postId');
        const scheduledAt = requiredString(args, 'scheduledAt');
        const date = new Date(scheduledAt);
        if (!Number.isFinite(date.getTime()) || !/^\d{4}-\d\d-\d\dT/.test(scheduledAt)) throw new OperationError('invalid_request', 'scheduledAt must be an ISO date-time.');
        requireConfirmation(args, `SCHEDULE POST ${postId} ${scheduledAt}`);
        const scheduleMode = parseScheduleMode(args.scheduleMode);
        const destinationScheduleModes = parseDestinationScheduleModes(args.destinationScheduleModes);
        const outcome = await schedulePost(publishingActor(viewer), postId, date, { ...(scheduleMode ? { scheduleMode } : {}), ...(destinationScheduleModes ? { destinationScheduleModes } : {}) });
        return auditedReceipt(viewer, name, { postId, scheduledAt: date.toISOString(), scheduleMode: outcome.scheduleMode }, { postId, status: 'scheduled', scheduledAt: date.toISOString(), scheduleMode: outcome.scheduleMode, destinationScheduleModes: outcome.destinationScheduleModes, remoteHold: outcome.remoteHold });
      }
      case 'reschedule_post': {
        const postId = requiredString(args, 'postId');
        const scheduledAt = requiredString(args, 'scheduledAt');
        const date = isoInstant(scheduledAt, 'scheduledAt');
        requireConfirmation(args, `RESCHEDULE POST ${postId} ${scheduledAt}`);
        const result = await reschedulePostToInstant(publishingActor(viewer), postId, date);
        return auditedReceipt(viewer, name, { postId, scheduledAt: result.scheduledAt.toISOString() }, { postId, status: 'scheduled', scheduledAt: result.scheduledAt.toISOString() });
      }
      case 'import_posts': {
        requireConfirmation(args, 'IMPORT POSTS');
        if (typeof args.csv !== 'string' || !args.csv.trim()) throw new OperationError('invalid_request', 'csv is required.');
        const result = await importPostsCsv(publishingActor(viewer), args.csv);
        return auditedReceipt(viewer, name, { count: result.count }, { imported: result.count, status: 'draft' });
      }
      case 'cancel_scheduled_post': {
        const postId = requiredString(args, 'postId');
        requireConfirmation(args, `CANCEL SCHEDULE ${postId}`);
        await cancelScheduledPost(publishingActor(viewer), postId);
        return auditedReceipt(viewer, name, { postId }, { postId, status: 'draft' });
      }
        default: throw new OperationError('invalid_request', `Unknown tool: ${name}`);
      }
    },
  },
];
