import { executeSystemAlertTool, systemAlertToolDefinitions } from '@/modules/notifications/chat-channels/alerts-mcp';
import { rootMonitoringToolDefinitions, rootMonitoringTools, rootMonitoringResources, executeRootMonitoringTool } from '@/modules/root/mcp';
import { readRootConfig, saveRootConfig } from '@/modules/root/server/configuration';
import { listRootInboxDeletions, confirmRootInboxDeletion } from '../root/inbox-deletions';
import { listRootPostDeletions, recordRootPostDeletionOutcome } from '../root/post-deletions';
import { adoptRootLegacyPublication, finishRootPublicationProjection, listRootPublicationAttempts, recordRootPublicationOutcome } from '../root/publication-attempts';
import { z } from 'zod';
import { listRootDiagnostics, runRootDiagnostics } from '../root/diagnostics';
import { loadRootOperations } from '../root/operations';
import { prisma } from '../data';
import { runtimeConfig } from '../config/store';
import { CONFIG_SCHEMA_VERSION } from '@/lib/config/registry';
import { OperationError, operationFailure } from '@/lib/operation-error';
import { setRootWorkspaceAccess } from '../root/workspace-access';
import { listRootWorkspaces } from '../root/directory';
import { createRootWorkspace, renameRootWorkspace } from '../root/workspace-controls';
import { listRootActivity } from '../root/activity';
import { loadRootUsers } from '../root/users';
import { resetRootUserTwoStep, revokeRootUserSessions, setRootUserDisabled } from '../root/user-controls';
import { readRootPlatformPublicationEvidence, runRootPlatformPublicationAction } from '../root/platform-publication-evidence';
import { rootUserActions, rootUserConfirmationSchema, rootUserIdSchema } from '@/lib/root-user-controls';
import { rootLegacyToolDefinitions, rootLegacyResources, rootLegacyTools, callRootLegacyTool } from '../root/legacy/mcp';
import { executeRootChangelogTool, rootChangelogResources, rootChangelogToolDefinitions, rootChangelogTools } from '@/modules/history/root-mcp';
import type { RootMcpActor } from './types';
import { ROOT_EVIDENCE_POLICY } from '@/lib/config/root-evidence-policy';
import { loadRootEvidencePolicy, loadRootEvidenceCopy } from '../root/platform-publication-evidence';

export const rootToolDefinitions = [
  ...rootLegacyToolDefinitions,
  ...rootMonitoringToolDefinitions,
  ...rootChangelogToolDefinitions,
  ...systemAlertToolDefinitions,
  { name: 'list_root_inbox_deletions', description: 'Private bounded Inbox deletion recovery history. Includes remote object identity for operator verification, never credentials or comment content. Workspace keys cannot use this tool.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'confirm_root_inbox_deletion', description: 'Record an operator attestation only after separately verifying actual remote deletion. This is not an automatic provider check; it never contacts the platform or removes local rows. Require verifiedOnPlatform:true and exact CONFIRM REMOTE DELETION <operationId>. Workspace keys cannot use this tool.', inputSchema: { type: 'object', required: ['operationId', 'verifiedOnPlatform', 'confirmation'], properties: { operationId: { type: 'string' }, verifiedOnPlatform: { const: true, type: 'boolean' }, confirmation: { type: 'string' } }, additionalProperties: false } },
  { name: 'list_root_post_deletions', description: 'Private bounded recent Publishing post deletion history. Shows remote and local post identities to installation owners only; excludes post content, credentials and provider errors.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'record_root_post_deletion_outcome', description: 'Record a human-verified platform outcome for an uncertain remote post deletion. Never contacts the provider or performs local cleanup. A delayed request may still take effect after NOT DELETED; verify again before any new attempt. Require verifiedOnPlatform:true and exact ROOT RECORD POST DELETION <operationId> DELETED or NOT DELETED. Workspace keys cannot use this tool.', inputSchema: { type: 'object', required: ['operationId', 'outcome', 'verifiedOnPlatform', 'confirmation'], properties: { operationId: { type: 'string' }, outcome: { type: 'string', enum: ['deleted', 'not_deleted'] }, verifiedOnPlatform: { const: true, type: 'boolean' }, confirmation: { type: 'string' } }, additionalProperties: false } },
  { name: 'list_root_publication_attempts', description: 'Private bounded content-free history of publication attempts and receipts. Workspace keys cannot use this tool.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'get_root_platform_publication_evidence', description: 'Private bounded publication receipt steps from one installed platform, including when customer access to it is disabled. Returns module-owned columns, known operation/receipt IDs and any available action metadata; this read never executes actions or returns customer content or credentials. Workspace keys cannot use this tool.', inputSchema: { type: 'object', required: ['providerId'], properties: { providerId: { type: 'string', minLength: 1, maxLength: ROOT_EVIDENCE_POLICY.providerIdCharacters }, operationId: { type: 'string', minLength: 1, maxLength: ROOT_EVIDENCE_POLICY.operationIdCharacters } }, additionalProperties: false } },
  { name: 'run_root_platform_publication_action', description: 'Run one explicitly declared private Root action for an installed platform evidence row. Supply the module-provided action ID, subject ID, exact confirmation and acknowledged:true; include only module-declared scalar fieldValues when required. An action may record a human attestation and does not necessarily contact or confirm the remote platform. The platform module rechecks current evidence and policy. Workspace keys cannot use this tool.', inputSchema: { type: 'object', required: ['providerId', 'actionId', 'subjectId', 'confirmation', 'acknowledged'], properties: { providerId: { type: 'string', minLength: 1, maxLength: ROOT_EVIDENCE_POLICY.providerIdCharacters }, actionId: { type: 'string', minLength: 1, maxLength: ROOT_EVIDENCE_POLICY.actionIdCharacters }, subjectId: { type: 'string', minLength: 1, maxLength: ROOT_EVIDENCE_POLICY.identifierCharacters }, confirmation: { type: 'string', minLength: 1, maxLength: ROOT_EVIDENCE_POLICY.confirmationCharacters }, acknowledged: { const: true, type: 'boolean' }, fieldValues: { type: 'object', maxProperties: ROOT_EVIDENCE_POLICY.fieldCount, propertyNames: { pattern: `^[A-Za-z][A-Za-z0-9_-]{0,${ROOT_EVIDENCE_POLICY.fieldKeyCharacters - 1}}$` }, additionalProperties: { oneOf: [{ type: 'string', maxLength: ROOT_EVIDENCE_POLICY.fieldValueCharacters }, { type: 'boolean' }] } } }, additionalProperties: false } },
  { name: 'record_root_publication_outcome', description: 'Record a human external check for an uncertain or submitted publication. A known submission ID cannot be replaced or attested absent. This does not contact or verify the platform; a delayed request may still complete. Require verifiedExternally:true and exact ROOT RECORD PUBLICATION <operationId> PUBLISHED or ABSENT. Workspace keys cannot use this tool.', inputSchema: { type: 'object', required: ['operationId', 'outcome', 'verifiedExternally', 'confirmation'], properties: { operationId: { type: 'string' }, outcome: { type: 'string', enum: ['PUBLISHED', 'ABSENT'] }, remotePostId: { type: 'string' }, remoteUrl: { type: 'string' }, verifiedExternally: { const: true, type: 'boolean' }, confirmation: { type: 'string' } }, additionalProperties: false } },
  { name: 'finish_root_publication_projection', description: 'Finish projection of a saved receipt into local records only. Never sends another request. Confirmation must exactly match ROOT FINISH PUBLICATION <operationId>. Installation owner only.', inputSchema: { type: 'object', required: ['operationId', 'confirmation'], properties: { operationId: { type: 'string' }, confirmation: { type: 'string' } }, additionalProperties: false } },
  { name: 'adopt_root_legacy_publication', description: 'Adopt a legacy processing destination after an external check. This creates a recovery record and never contacts the platform. Confirmation must exactly match ROOT ADOPT PUBLICATION <postTargetId>. Installation owner only.', inputSchema: { type: 'object', required: ['postTargetId', 'confirmation'], properties: { postTargetId: { type: 'string' }, confirmation: { type: 'string' } }, additionalProperties: false } },
  { name: 'get_root_operations', description: 'Private rebuild-only worker heartbeat and bounded job history. Optional product module ID. Stored raw summaries, provider errors and worker hostnames are excluded. Workspace keys cannot use this tool.', inputSchema: { type: 'object', properties: { moduleId: { type: 'string' } }, additionalProperties: false } },
  { name: 'get_root_diagnostics', description: 'Private diagnostic history and bounded recent connection choices. Scope is shared, product:<installed module id>, or platform:<installed provider id>. No credentials or raw transport errors.', inputSchema: { type: 'object', properties: { scope: { type: 'string' } }, additionalProperties: false } },
  { name: 'run_root_diagnostics', description: 'Run private predefined module checks and read-only provider connectivity tests. Confirmation must exactly match RUN DIAGNOSTICS <scope>. Scope-wide cooldown and durable start audit apply across interfaces. Optional connectionId belongs to the selected platform. No publishing, ads or message changes. Inspect check statuses and auditRecorded; a pass verifies only its stated check.', inputSchema: { type: 'object', required: ['scope', 'confirmation'], properties: { scope: { type: 'string' }, connectionId: { type: 'string' }, confirmation: { type: 'string' } }, additionalProperties: false } },
  { name: 'list_root_users', description: 'Private installation user directory. Filter name/email and all, active, disabled or owners. Active sessions exclude expired and pending verification sessions. Credentials and factor material are excluded. Workspace API keys cannot use this tool.', inputSchema: { type: 'object', properties: { q: { type: 'string' }, status: { type: 'string', enum: ['all', 'active', 'disabled', 'owners'] }, page: { type: 'integer', minimum: 1 } }, additionalProperties: false } },
  { name: 'manage_root_user', description: 'Private installation-owner account access and recovery. Confirmation must exactly match DISABLE <email>, ENABLE <email>, SIGN OUT <email> or RESET TWO-STEP <email>. Self-actions are denied; owner second-factor reset is denied. Disabling revokes sessions and blocks keys. Sign out revokes browser sessions only; API keys retain current access. Every change has a transactional domain audit.', inputSchema: { type: 'object', required: ['userId', 'action', 'confirmation'], properties: { userId: { type: 'string', minLength: 1, maxLength: 200 }, action: { type: 'string', enum: [...rootUserActions] }, confirmation: { type: 'string', minLength: 1, maxLength: 400 } }, additionalProperties: false } },
  { name: 'get_root_config', description: 'Read installation configuration definitions and safe values. Only available to the signed-in instance owner; secrets are masked.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'create_root_workspace', description: 'Create a workspace for an existing active account. Confirmation must exactly match CREATE <trimmed name> FOR <lowercase ownerEmail>. Optional timezone defaults to the Root workspace timezone. Uses the same transactional membership creation and domain audit as REST. Installation owner only; workspace keys cannot use this tool.', inputSchema: { type: 'object', required: ['name', 'ownerEmail', 'confirmation'], properties: { name: { type: 'string', minLength: 1 }, ownerEmail: { type: 'string', format: 'email' }, timezone: { type: 'string' }, confirmation: { type: 'string', minLength: 1 } }, additionalProperties: false } },
  { name: 'rename_root_workspace', description: 'Rename a workspace. Confirmation must exactly match RENAME <current name> TO <trimmed new name>. Refuses deletion in progress and concurrent name changes, with the same transactional domain audit as REST. Installation owner only; workspace keys cannot use this tool.', inputSchema: { type: 'object', required: ['workspaceId', 'name', 'confirmation'], properties: { workspaceId: { type: 'string', minLength: 1 }, name: { type: 'string', minLength: 1 }, confirmation: { type: 'string', minLength: 1 } }, additionalProperties: false } },
  { name: 'list_root_workspaces', description: 'Private installation-owner workspace directory, including access state and record counts. Workspace API keys cannot use this tool.', inputSchema: { type: 'object', properties: { q: { type: 'string' }, page: { type: 'integer', minimum: 1 } }, additionalProperties: false } },
  { name: 'list_root_activity', description: 'Private installation-owner audit history. Search actions or people; filter exact workspace ID and inclusive UTC dates. Raw audit detail is omitted. Follow olderCursor/newerCursor with the same filters. Workspace API keys cannot use this tool.', inputSchema: { type: 'object', properties: { q: { type: 'string' }, workspaceId: { type: 'string' }, from: { type: 'string', description: 'UTC date, YYYY-MM-DD.' }, to: { type: 'string', description: 'Inclusive UTC date, YYYY-MM-DD.' }, limit: { type: 'integer', minimum: 1 }, cursor: { type: 'string' } }, additionalProperties: false } },
  { name: 'set_root_workspace_access', description: 'Suspend or restore workspace member access and new app operations. Only signed-in installation owners. Confirmation must exactly match SUSPEND WORKSPACE <workspaceId> or RESTORE WORKSPACE <workspaceId>. Data is retained; existing provider content is not deleted.', inputSchema: { type: 'object', required: ['workspaceId', 'suspended', 'confirmation'], properties: { workspaceId: { type: 'string' }, suspended: { type: 'boolean' }, confirmation: { type: 'string' } }, additionalProperties: false } },
  { name: 'set_root_config', description: 'Validate and save an installation setting. Only available to the signed-in instance owner. Confirmation must exactly match SET ROOT CONFIG <key> or CLEAR ROOT SECRET <key>.', inputSchema: { type: 'object', required: ['key', 'confirmation'], properties: { key: { type: 'string' }, value: {}, clear: { type: 'boolean' }, confirmation: { type: 'string' } }, additionalProperties: false } },
];

export const rootTools = new Set(rootToolDefinitions.map(tool => tool.name));
export const canUseRootTool = (viewer: RootMcpActor) => viewer.isInstanceOwner === true && !viewer.apiKeyId;
const resourceDefinitions = [
  ...rootLegacyResources,
  ...rootMonitoringResources,
  ...rootChangelogResources,
  { uri: 'msp://root/inbox-deletions', name: 'Inbox deletion recovery', description: 'Private bounded operator deletion history and remote identity; credentials excluded.', tool: 'list_root_inbox_deletions' },
  { uri: 'msp://root/post-deletions', name: 'Publishing post deletion recovery', description: 'Private bounded operator deletion history and remote identity; post content and credentials excluded.', tool: 'list_root_post_deletions' },
  { uri: 'msp://root/publication-attempts', name: 'Publication attempt recovery', description: 'Private bounded publication receipts and safe attempt state; post content and credentials excluded.', tool: 'list_root_publication_attempts' },
  { uri: 'msp://root/platform-publication-evidence', name: 'Platform publication evidence', description: 'Private bounded publication receipt evidence and available action metadata aggregated across installed platform modules. Reading this resource never executes actions.', tool: 'get_root_platform_publication_evidence_resource' },
  { uri: 'msp://root/alerts', name: 'Installation alerts', description: 'Private incident history for this installation; no raw detail.', tool: 'list_root_system_alerts' },
  { uri: 'msp://root/operations', name: 'Replacement operations', description: 'Private replacement-only worker health; no raw errors.', tool: 'get_root_operations' },
  { uri: 'msp://root/diagnostics', name: 'Shared diagnostics', description: 'Private shared diagnostic history and configuration.', tool: 'get_root_diagnostics' },
  { uri: 'msp://root/users', name: 'Installation users', description: 'Private bounded user directory, access and verification status; credentials excluded.', tool: 'list_root_users' },
  { uri: 'msp://root/config', name: 'Root configuration', description: 'Installation setting definitions and safe values.', tool: 'get_root_config' },
  { uri: 'msp://root/workspaces', name: 'Installation workspaces', description: 'Private bounded workspace directory and access state.', tool: 'list_root_workspaces' },
  { uri: 'msp://root/activity', name: 'Installation activity', description: 'Private bounded audit history with safe metadata.', tool: 'list_root_activity' },
];
export const rootResources = resourceDefinitions.map(({ tool: _tool, ...resource }) => ({ ...resource, mimeType: 'application/json' }));
export const rootResourceTool = (uri: string) => resourceDefinitions.find(resource => resource.uri === uri)?.tool;
const configInput = z.object({ key: z.string().min(1), value: z.unknown().optional(), clear: z.boolean().optional(), confirmation: z.string().min(1) }).strict();
const userInput = z.object({ userId: rootUserIdSchema, action: z.enum(rootUserActions), confirmation: rootUserConfirmationSchema }).strict();

/** Shared private dispatcher. Each service owns any required lifecycle locks. */
export async function runRootTool(viewer: RootMcpActor, name: string, args: Record<string, unknown>) {
  try {
    if (!canUseRootTool(viewer)) throw new OperationError('forbidden', 'Installation-owner access is required.');
    const actor = await prisma.user.findUnique({ where: { id: viewer.userId }, select: { isInstanceOwner: true, disabledAt: true } });
    if (!actor?.isInstanceOwner || actor.disabledAt) throw new OperationError('forbidden', 'Installation-owner access is required.');
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw new OperationError('invalid_request', 'Tool arguments must be an object.');
    if (rootMonitoringTools.has(name)) return await executeRootMonitoringTool(viewer.userId, name, args, viewer.maxResultItems ?? Number(await runtimeConfig('mcp.maxResultItems')));
    if (rootLegacyTools.has(name)) return await callRootLegacyTool({ ...viewer, maxResultItems: viewer.maxResultItems ?? Number(await runtimeConfig('mcp.maxResultItems')) }, name, args);
    if (systemAlertToolDefinitions.some(tool => tool.name === name)) return await executeSystemAlertTool({ ...viewer, isInstanceOwner: true }, name, args);
    if (rootChangelogTools.has(name)) return await executeRootChangelogTool(viewer.userId, name, args, viewer.maxResultItems ?? Number(await runtimeConfig('mcp.maxResultItems')));
    switch (name) {
      case 'list_root_inbox_deletions':
        if (Object.keys(args).length) throw new OperationError('invalid_request', 'This read does not accept filters.');
        return await listRootInboxDeletions(viewer.userId, viewer.maxResultItems ?? Number(await runtimeConfig('mcp.maxResultItems')));
      case 'confirm_root_inbox_deletion': return await confirmRootInboxDeletion(viewer.userId, args);
      case 'list_root_post_deletions':
        if (Object.keys(args).length) throw new OperationError('invalid_request', 'This read does not accept filters.');
        return await listRootPostDeletions(viewer.userId, viewer.maxResultItems ?? Number(await runtimeConfig('mcp.maxResultItems')));
      case 'record_root_post_deletion_outcome': return await recordRootPostDeletionOutcome(viewer.userId, args);
      case 'list_root_publication_attempts':
        if (Object.keys(args).length) throw new OperationError('invalid_request', 'This read does not accept filters.');
        return await listRootPublicationAttempts(viewer.userId, viewer.maxResultItems ?? Number(await runtimeConfig('mcp.maxResultItems')));
      case 'get_root_platform_publication_evidence': {
        const copy = await loadRootEvidenceCopy();
        const parsed = z.object({ providerId: z.string().min(1), operationId: z.string().min(1).optional() }).strict().safeParse(args);
        if (!parsed.success) throw new OperationError('invalid_request', copy.choosePlatformAndLimit);
        const policy = await loadRootEvidencePolicy(copy);
        return await readRootPlatformPublicationEvidence(viewer.userId, { ...parsed.data, resultCap: Math.min(policy.resultCap, viewer.maxResultItems ?? Number(await runtimeConfig('mcp.maxResultItems'))) }, policy, copy);
      }
      case 'run_root_platform_publication_action': return await runRootPlatformPublicationAction(viewer.userId, args);
      case 'get_root_platform_publication_evidence_resource':
        if (Object.keys(args).length) throw new OperationError('invalid_request', 'This resource does not accept filters.');
        {
          const copy = await loadRootEvidenceCopy();
          const policy = await loadRootEvidencePolicy(copy);
          return await readRootPlatformPublicationEvidence(viewer.userId, { resultCap: Math.min(policy.resultCap, viewer.maxResultItems ?? Number(await runtimeConfig('mcp.maxResultItems'))) }, policy, copy);
        }
      case 'record_root_publication_outcome': return await recordRootPublicationOutcome(viewer.userId, args);
      case 'finish_root_publication_projection': return await finishRootPublicationProjection(viewer.userId, args);
      case 'adopt_root_legacy_publication': return await adoptRootLegacyPublication(viewer.userId, args);
      case 'get_root_operations': {
        const parsed = z.object({ moduleId: z.string().optional() }).strict().safeParse(args);
        if (!parsed.success) throw new OperationError('invalid_request', 'Choose a valid product module.');
        return await loadRootOperations(viewer.userId, parsed.data.moduleId, viewer.maxResultItems ?? Number(await runtimeConfig('mcp.maxResultItems')));
      }
      case 'get_root_diagnostics': {
        const parsed = z.object({ scope: z.string().optional() }).strict().safeParse(args);
        if (!parsed.success) throw new OperationError('invalid_request', 'Choose one diagnostic scope.');
        return await listRootDiagnostics(viewer.userId, parsed.data.scope ?? 'shared', viewer.maxResultItems ?? Number(await runtimeConfig('mcp.maxResultItems')));
      }
      case 'run_root_diagnostics': return await runRootDiagnostics(viewer.userId, args);
      case 'list_root_users': {
        if (Object.keys(args).some(key => !['q', 'page', 'status'].includes(key)) || args.q !== undefined && typeof args.q !== 'string' || args.status !== undefined && typeof args.status !== 'string' || args.page !== undefined && (typeof args.page !== 'number' || !Number.isSafeInteger(args.page) || args.page < 1)) throw new OperationError('invalid_request', 'Choose valid user filters and page.');
        const input = { ...(args.q === undefined ? {} : { q: args.q as string }), ...(args.status === undefined ? {} : { status: args.status as string }), ...(args.page === undefined ? {} : { page: String(args.page) }) };
        return await loadRootUsers(viewer.userId, input, viewer.maxResultItems ?? Number(await runtimeConfig('mcp.maxResultItems')));
      }
      case 'manage_root_user': {
        const parsed = userInput.safeParse(args);
        if (!parsed.success) throw new OperationError('invalid_request', 'Enter a valid account action and exact confirmation.');
        const { userId, action, confirmation } = parsed.data;
        const result = action === 'disable' || action === 'enable'
          ? await setRootUserDisabled(viewer.userId, userId, action === 'disable', confirmation)
          : action === 'sign-out' ? await revokeRootUserSessions(viewer.userId, userId, confirmation)
            : await resetRootUserTwoStep(viewer.userId, userId, confirmation);
        return { userId, action, ...result };
      }
      case 'get_root_config':
        if (Object.keys(args).length) throw new OperationError('invalid_request', 'This read does not accept filters.');
        return await readRootConfig(viewer.userId);
      case 'list_root_activity':
        return await listRootActivity(viewer.userId, args, viewer.maxResultItems ?? Number(await runtimeConfig('mcp.maxResultItems')));
      case 'create_root_workspace': {
        const parsed = z.object({ name: z.string().trim().min(1), ownerEmail: z.string().trim().email(), timezone: z.string().optional(), confirmation: z.string().min(1) }).strict().safeParse(args);
        if (!parsed.success) throw new OperationError('invalid_request', 'Enter a workspace name, owner email and exact confirmation.');
        const input = parsed.data;
        return await createRootWorkspace(viewer.userId, input);
      }
      case 'rename_root_workspace': {
        const parsed = z.object({ workspaceId: z.string().min(1), name: z.string().trim().min(1), confirmation: z.string().min(1) }).strict().safeParse(args);
        if (!parsed.success) throw new OperationError('invalid_request', 'Choose a workspace, a name and the exact confirmation.');
        const input = parsed.data;
        return await renameRootWorkspace(viewer.userId, input.workspaceId, input.name, input.confirmation);
      }
      case 'list_root_workspaces': {
        if (Object.keys(args).some(key => !['q', 'page'].includes(key)) || args.q !== undefined && typeof args.q !== 'string' || args.page !== undefined && (typeof args.page !== 'number' || !Number.isSafeInteger(args.page) || args.page < 1)) throw new OperationError('invalid_request', 'Choose a valid workspace query and page.');
        const cap = viewer.maxResultItems ?? Number(await runtimeConfig('mcp.maxResultItems'));
        return await listRootWorkspaces(viewer.userId, { q: args.q as string | undefined, page: args.page === undefined ? undefined : String(args.page) }, cap);
      }
      case 'set_root_workspace_access':
        if (Object.keys(args).some(key => !['workspaceId', 'suspended', 'confirmation'].includes(key)) || typeof args.workspaceId !== 'string' || !args.workspaceId.trim() || typeof args.suspended !== 'boolean' || typeof args.confirmation !== 'string' || !args.confirmation.length) throw new OperationError('invalid_request', 'Invalid workspace access change.');
        return await setRootWorkspaceAccess(viewer.userId, args.workspaceId, args.suspended, args.confirmation);
      case 'set_root_config': {
        const parsed = configInput.safeParse(args);
        if (!parsed.success) throw new OperationError('invalid_request', 'Enter a valid configuration change and exact confirmation.');
        const input = parsed.data;
        await saveRootConfig(input, viewer.userId);
        return { key: input.key, saved: true, schemaVersion: CONFIG_SCHEMA_VERSION };
      }
      default: throw new OperationError('invalid_request', 'Unknown installation tool.');
    }
  } catch (error) {
    const failure = operationFailure(error, 'The installation operation could not be completed. Please try again.');
    throw new OperationError(failure.code, failure.error);
  }
}
