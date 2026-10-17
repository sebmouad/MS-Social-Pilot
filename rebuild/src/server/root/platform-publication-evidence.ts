import { z } from 'zod';
import { OperationError } from '@/lib/operation-error';
import { installedPublicationRecovery } from '@/server/platforms/publication-recovery';
import { PLATFORM_MODULES } from '@/platforms';
import { runtimeConfig } from '@/server/config/store';
import { requireActiveRoot } from './operations';
import type { PlatformPublicationAction, PlatformPublicationActionInput, PlatformPublicationActionResult, PlatformPublicationEvidence } from '@/server/platforms/host';

// Platform receipt identifiers are accepted up to this same integrity bound.
const maxEvidenceCellCharacters = 2048;
const inputSchema = z.object({
  providerId: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/).optional(),
  operationId: z.string().regex(/^[A-Za-z0-9_-]{1,200}$/).optional(),
  resultCap: z.number().int().safe().min(1).max(1000).optional(),
}).strict();
const actionInputSchema = z.object({
  providerId: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),
  actionId: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),
  subjectId: z.string().min(1).max(maxEvidenceCellCharacters),
  confirmation: z.string().min(1).max(400),
  acknowledged: z.literal(true),
}).strict();

export type RootPlatformPublicationEvidencePanel = PlatformPublicationEvidence & { providerId: string };
export type RootPlatformPublicationEvidenceResult = RootPlatformPublicationEvidencePanel | {
  providers: RootPlatformPublicationEvidencePanel[];
  truncated: boolean;
};

const safeFallback = () => new OperationError('upstream_failure', 'Platform publication evidence could not be loaded.');
const validLimit = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 1 && (value as number) <= 1000;

async function configuredEvidenceLimit() {
  let configured: unknown;
  try { configured = await runtimeConfig('root.platformEvidenceLimit'); }
  catch { throw new OperationError('unavailable', 'The platform publication evidence limit is unavailable.'); }
  if (!validLimit(configured)) throw new OperationError('unavailable', 'The platform publication evidence limit is unavailable.');
  return configured;
}

function safeEvidence(value: PlatformPublicationEvidence, providerId: string): RootPlatformPublicationEvidencePanel {
  if (!value || typeof value.title !== 'string' || typeof value.description !== 'string' ||
    !Array.isArray(value.columns) || !Array.isArray(value.items) || typeof value.truncated !== 'boolean') throw safeFallback();
  const keys = new Set<string>();
  const columns = value.columns.map(column => {
    if (!column || typeof column.key !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(column.key) ||
      typeof column.label !== 'string' || !column.label.trim() || column.label.length > 120 || keys.has(column.key)) throw safeFallback();
    keys.add(column.key);
    return { key: column.key, label: column.label };
  });
  if (!columns.length || value.title.length > 200 || value.description.length > 1000) throw safeFallback();
  const items = value.items.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw safeFallback();
    const clean: Record<string, string | number | null> = {};
    for (const column of columns) {
      const cell = item[column.key];
      if (cell === undefined || cell === null || typeof cell === 'number' && Number.isFinite(cell)) clean[column.key] = cell ?? null;
      else if (typeof cell === 'string' && cell.length <= maxEvidenceCellCharacters && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(cell)) clean[column.key] = cell;
      else throw safeFallback();
    }
    return clean;
  });
  let rowIdKey: string | undefined;
  let actions: PlatformPublicationAction[] | undefined;
  if (value.actions !== undefined) {
    if (!Array.isArray(value.actions) || typeof value.rowIdKey !== 'string' || !keys.has(value.rowIdKey)) throw safeFallback();
    const visibleRows = new Set(items.map(item => item[value.rowIdKey!]).filter((id): id is string => typeof id === 'string'));
    actions = value.actions.flatMap(action => {
      if (!action || typeof action !== 'object' ||
        typeof action.rowId !== 'string' || action.rowId.length > maxEvidenceCellCharacters ||
        typeof action.actionId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(action.actionId) ||
        typeof action.subjectId !== 'string' || !action.subjectId || action.subjectId.length > maxEvidenceCellCharacters ||
        typeof action.label !== 'string' || !action.label.trim() || action.label.length > 120 ||
        typeof action.description !== 'string' || !action.description.trim() || action.description.length > 1000 ||
        typeof action.acknowledgmentLabel !== 'string' || !action.acknowledgmentLabel.trim() || action.acknowledgmentLabel.length > 240 ||
        typeof action.confirmation !== 'string' || !action.confirmation.trim() || action.confirmation.length > 400 ||
        [action.rowId, action.subjectId, action.label, action.description, action.acknowledgmentLabel, action.confirmation].some(text => /[\u0000-\u001f\u007f]/.test(text))) throw safeFallback();
      // The module may return actions for the extra lookahead row; only actions for
      // rows visible under the current cap leave this service.
      return visibleRows.has(action.rowId) ? [{ rowId: action.rowId, actionId: action.actionId, subjectId: action.subjectId, label: action.label, description: action.description, acknowledgmentLabel: action.acknowledgmentLabel, confirmation: action.confirmation }] : [];
    });
    rowIdKey = value.rowIdKey;
  } else if (value.rowIdKey !== undefined) throw safeFallback();
  return { providerId, title: value.title, description: value.description, columns, items, truncated: value.truncated,
    ...(rowIdKey === undefined ? {} : { rowIdKey }), ...(actions === undefined ? {} : { actions }) };
}

function safeActionResult(value: PlatformPublicationActionResult, action: PlatformPublicationActionInput): PlatformPublicationActionResult {
  if (!value || typeof value !== 'object' || value.actionId !== action.actionId || value.subjectId !== action.subjectId ||
    typeof value.operationId !== 'string' || !value.operationId || value.operationId.length > maxEvidenceCellCharacters ||
    !/^[A-Za-z0-9_-]+$/.test(value.operationId) || !['confirmed', 'rejected', 'needs_review'].includes(value.state) ||
    typeof value.ok !== 'boolean' || typeof value.message !== 'string' || !value.message.trim() || value.message.length > 500 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value.message)) throw safeFallback();
  // Only the module can affirm completion, and only with a matching confirmed receipt.
  if (value.state === 'confirmed' && !value.ok || value.state !== 'confirmed' && value.ok) throw safeFallback();
  return { ok: value.ok, actionId: value.actionId, subjectId: value.subjectId, operationId: value.operationId, state: value.state, message: value.message };
}

function limitPanel(evidence: RootPlatformPublicationEvidencePanel, items: RootPlatformPublicationEvidencePanel['items'], truncated: boolean): RootPlatformPublicationEvidencePanel {
  const visibleIds = evidence.rowIdKey ? new Set(items.map(item => item[evidence.rowIdKey!]).filter((id): id is string => typeof id === 'string')) : null;
  return { ...evidence, items, truncated, ...(visibleIds && evidence.actions ? { actions: evidence.actions.filter(action => visibleIds.has(action.rowId)) } : {}) };
}

/** Read content-free receipt evidence for installed platform modules, including modules currently disabled for customers. */
export async function readRootPlatformPublicationEvidence(userId: string, input: unknown = {}) {
  await requireActiveRoot(userId);
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) throw new OperationError('invalid_request', 'Choose an installed platform and a valid publication operation or result limit.');
  const { providerId, operationId } = parsed.data;
  const rootLimit = await configuredEvidenceLimit();
  const cap = Math.min(rootLimit, parsed.data.resultCap ?? rootLimit);
  if (providerId !== undefined) {
    if (!PLATFORM_MODULES.some(module => module.id === providerId)) throw new OperationError('invalid_request', 'Choose an installed platform.');
    const recovery = installedPublicationRecovery(providerId);
    if (!recovery?.readEvidence) throw new OperationError('unavailable', 'Publication evidence is not available for this installed platform.');
    try {
      const evidence = safeEvidence(await recovery.readEvidence(operationId, cap + 1), providerId);
      return limitPanel(evidence, evidence.items.slice(0, cap), evidence.truncated || evidence.items.length > cap);
    } catch (error) {
      if (error instanceof OperationError) throw error;
      throw safeFallback();
    }
  }
  if (operationId !== undefined) throw new OperationError('invalid_request', 'Choose a platform when filtering by publication operation.');

  const providers: RootPlatformPublicationEvidencePanel[] = [];
  let remaining = cap;
  let truncated = false;
  for (const { id } of PLATFORM_MODULES) {
    const recovery = installedPublicationRecovery(id);
    if (!recovery?.readEvidence) continue;
    try {
      const evidence = safeEvidence(await recovery.readEvidence(undefined, Math.max(1, remaining + 1)), id);
      const visible = evidence.items.slice(0, remaining);
      const panelTruncated = evidence.truncated || visible.length < evidence.items.length;
      providers.push(limitPanel(evidence, visible, panelTruncated));
      remaining -= visible.length;
      truncated ||= panelTruncated;
    } catch (error) {
      if (error instanceof OperationError) throw error;
      throw safeFallback();
    }
  }
  return { providers, truncated } satisfies RootPlatformPublicationEvidenceResult;
}

/** Dispatch a module-owned Root action. The module rechecks its private locks and exact confirmation. */
export async function runRootPlatformPublicationAction(userId: string, input: unknown) {
  await requireActiveRoot(userId);
  const parsed = actionInputSchema.safeParse(input);
  if (!parsed.success) throw new OperationError('invalid_request', 'Enter one valid platform action and its exact confirmation.');
  const { providerId, ...action } = parsed.data;
  if (!PLATFORM_MODULES.some(module => module.id === providerId)) throw new OperationError('invalid_request', 'Choose an installed platform.');
  const recovery = installedPublicationRecovery(providerId);
  if (!recovery?.executeRootAction) throw new OperationError('unavailable', 'This platform action is not available.');
  try {
    return safeActionResult(await recovery.executeRootAction(userId, action), action);
  } catch (error) {
    if (error instanceof OperationError) throw error;
    throw new OperationError('upstream_failure', 'The platform action result could not be confirmed. Check the platform evidence before taking further action.');
  }
}
