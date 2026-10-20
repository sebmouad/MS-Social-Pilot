import { z } from 'zod';
import { OperationError } from '@/lib/operation-error';
import { installedPublicationRecovery } from '@/server/platforms/publication-recovery';
import { PLATFORM_MODULES } from '@/platforms';
import { runtimeConfig } from '@/server/config/store';
import { requireActiveRoot } from './operations';
import type { PlatformPublicationAction, PlatformPublicationActionField, PlatformPublicationActionInput, PlatformPublicationActionResult, PlatformPublicationEvidence } from '@/server/platforms/host';
import { PLATFORM_PUBLICATION_EVIDENCE_CELL_LIMIT } from '@/server/platforms/host';
import { ROOT_EVIDENCE_POLICY, type RootEvidencePolicy } from '@/lib/config/root-evidence-policy';
import { ROOT_EVIDENCE_COPY, type RootEvidenceCopy } from '@/lib/config/root-evidence-copy';

const policySchema = z.object(Object.fromEntries(Object.entries(ROOT_EVIDENCE_POLICY).map(([key, value]) => [key, z.number().int().safe().min(1).max(value)])) as { [K in keyof RootEvidencePolicy]: z.ZodNumber }).strict();
const evidenceCellCharacters = (policy: RootEvidencePolicy) => Math.min(policy.identifierCharacters, PLATFORM_PUBLICATION_EVIDENCE_CELL_LIMIT);
const readInputSchema = (policy: RootEvidencePolicy) => z.object({
  providerId: z.string().regex(new RegExp(`^[A-Za-z0-9_-]{1,${policy.providerIdCharacters}}$`)).optional(),
  operationId: z.string().regex(new RegExp(`^[A-Za-z0-9_-]{1,${policy.operationIdCharacters}}$`)).optional(),
  resultCap: z.number().int().safe().min(1).max(policy.resultCap).optional(),
}).strict();
const actionInputSchema = (policy: RootEvidencePolicy) => z.object({
  providerId: z.string().regex(new RegExp(`^[A-Za-z0-9_-]{1,${policy.providerIdCharacters}}$`)),
  actionId: z.string().regex(new RegExp(`^[A-Za-z0-9_-]{1,${policy.actionIdCharacters}}$`)),
  subjectId: z.string().min(1).max(evidenceCellCharacters(policy)),
  confirmation: z.string().min(1).max(policy.confirmationCharacters),
  acknowledged: z.literal(true),
  fieldValues: z.record(z.string().max(policy.fieldKeyCharacters).regex(new RegExp(`^[A-Za-z][A-Za-z0-9_-]{0,${policy.fieldKeyCharacters - 1}}$`)), z.union([z.string().max(Math.min(policy.fieldValueCharacters, PLATFORM_PUBLICATION_EVIDENCE_CELL_LIMIT)), z.boolean()])).superRefine((values, context) => {
    if (Object.keys(values).length > policy.fieldCount) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Too many action fields.' });
    for (const [key, value] of Object.entries(values)) if (/^[A-Za-z][A-Za-z0-9_-]*$/.test(key) && typeof value === 'string' && /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid action field.' });
  }).optional(),
}).strict();

export type RootPlatformPublicationEvidencePanel = PlatformPublicationEvidence & { providerId: string };
export type RootPlatformPublicationEvidenceResult = RootPlatformPublicationEvidencePanel | {
  providers: RootPlatformPublicationEvidencePanel[];
  truncated: boolean;
};

const safeFallback = (copy: RootEvidenceCopy) => new OperationError('upstream_failure', copy.evidenceReadFailure);
const unconfirmedAction = (copy: RootEvidenceCopy) => new OperationError('upstream_failure', copy.actionResultFailure);
const validLimit = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 1 && (value as number) <= ROOT_EVIDENCE_POLICY.resultCap;

export async function loadRootEvidenceCopy(): Promise<RootEvidenceCopy> {
  try {
    const configured = await runtimeConfig('root.platformEvidenceCopy');
    const schema = z.object(Object.fromEntries(Object.keys(ROOT_EVIDENCE_COPY).map(key => [key, z.string().trim().min(1).max(4000)])) as { [K in keyof RootEvidenceCopy]: z.ZodString }).strict();
    const parsed = schema.safeParse(configured);
    return parsed.success ? parsed.data : ROOT_EVIDENCE_COPY;
  } catch { return ROOT_EVIDENCE_COPY; }
}

export async function loadRootEvidencePolicy(copy: RootEvidenceCopy = ROOT_EVIDENCE_COPY): Promise<RootEvidencePolicy> {
  let configured: unknown;
  try { configured = await runtimeConfig('root.platformEvidencePolicy'); }
  catch { throw new OperationError('unavailable', copy.unavailablePolicy); }
  const parsed = policySchema.safeParse(configured);
  if (!parsed.success) throw new OperationError('unavailable', copy.unavailablePolicy);
  return { ...parsed.data,
    // Platform receipt cell integrity is fixed by the host wire/storage contract.
    identifierCharacters: Math.min(parsed.data.identifierCharacters, PLATFORM_PUBLICATION_EVIDENCE_CELL_LIMIT),
    fieldValueCharacters: Math.min(parsed.data.fieldValueCharacters, PLATFORM_PUBLICATION_EVIDENCE_CELL_LIMIT),
  };
}

async function configuredEvidenceLimit(copy: RootEvidenceCopy) {
  let configured: unknown;
  try { configured = await runtimeConfig('root.platformEvidenceLimit'); }
  catch { throw new OperationError('unavailable', copy.unavailableLimit); }
  if (!validLimit(configured)) throw new OperationError('unavailable', copy.unavailableLimit);
  return configured;
}

function safeEvidence(value: PlatformPublicationEvidence, providerId: string, policy: RootEvidencePolicy, maxRows: number, copy: RootEvidenceCopy): RootPlatformPublicationEvidencePanel {
  const maxEvidenceCellCharacters = evidenceCellCharacters(policy);
  if (!value || typeof value.title !== 'string' || typeof value.description !== 'string' ||
    !Array.isArray(value.columns) || !Array.isArray(value.items) || typeof value.truncated !== 'boolean') throw safeFallback(copy);
  const keys = new Set<string>();
  const columns = value.columns.map(column => {
    if (!column || typeof column.key !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(column.key) ||
      column.key.length > policy.columnKeyCharacters || typeof column.label !== 'string' || !column.label.trim() || column.label.length > policy.labelCharacters || keys.has(column.key)) throw safeFallback(copy);
    keys.add(column.key);
    return { key: column.key, label: column.label };
  });
  if (!columns.length || columns.length > policy.columnCount || value.items.length > maxRows || value.title.length > policy.metadataTitleCharacters || value.description.length > policy.metadataDescriptionCharacters) throw safeFallback(copy);
  const summaryColumnKeys = value.summaryColumnKeys;
  if (summaryColumnKeys !== undefined && (!Array.isArray(summaryColumnKeys) || !summaryColumnKeys.length ||
    summaryColumnKeys.length > columns.length || new Set(summaryColumnKeys).size !== summaryColumnKeys.length ||
    summaryColumnKeys.some(key => typeof key !== 'string' || !keys.has(key)))) throw safeFallback(copy);
  const items = value.items.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw safeFallback(copy);
    const clean: Record<string, string | number | null> = {};
    for (const column of columns) {
      const cell = Object.prototype.hasOwnProperty.call(item, column.key) ? item[column.key] : undefined;
      if (cell === undefined || cell === null || typeof cell === 'number' && Number.isFinite(cell)) clean[column.key] = cell ?? null;
      else if (typeof cell === 'string' && cell.length <= maxEvidenceCellCharacters && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(cell)) clean[column.key] = cell;
      else throw safeFallback(copy);
    }
    return clean;
  });
  let rowIdKey: string | undefined;
  let actions: PlatformPublicationAction[] | undefined;
  if (value.actions !== undefined) {
    if (!Array.isArray(value.actions) || value.actions.length > policy.actionCount || typeof value.rowIdKey !== 'string' || !keys.has(value.rowIdKey)) throw safeFallback(copy);
    const rowIds = items.map(item => item[value.rowIdKey!]);
    if (rowIds.some(id => typeof id !== 'string' || !id) || new Set(rowIds).size !== rowIds.length) throw safeFallback(copy);
    const visibleRows = new Set(rowIds as string[]);
    actions = value.actions.flatMap(action => {
      if (!action || typeof action !== 'object' ||
        action.intent !== undefined && !['inspect', 'change', 'delete'].includes(action.intent) ||
        typeof action.rowId !== 'string' || action.rowId.length > maxEvidenceCellCharacters ||
        typeof action.actionId !== 'string' || !new RegExp(`^[A-Za-z0-9_-]{1,${policy.actionIdCharacters}}$`).test(action.actionId) ||
        typeof action.subjectId !== 'string' || !action.subjectId || action.subjectId.length > maxEvidenceCellCharacters ||
        typeof action.label !== 'string' || !action.label.trim() || action.label.length > policy.labelCharacters ||
        typeof action.description !== 'string' || !action.description.trim() || action.description.length > policy.actionDescriptionCharacters ||
        typeof action.acknowledgmentLabel !== 'string' || !action.acknowledgmentLabel.trim() || action.acknowledgmentLabel.length > policy.acknowledgmentCharacters ||
        typeof action.confirmation !== 'string' || !action.confirmation.trim() || action.confirmation.length > policy.confirmationCharacters ||
        [action.rowId, action.subjectId, action.label, action.description, action.acknowledgmentLabel, action.confirmation].some(text => /[\u0000-\u001f\u007f]/.test(text))) throw safeFallback(copy);
      const fields = safeActionFields(action.fields, policy, copy);
      const context = safeActionContext(action.context, policy, copy);
      // The module may return actions for the extra lookahead row; only actions for
      // rows visible under the current cap leave this service.
      return visibleRows.has(action.rowId) ? [{ ...(action.intent === undefined ? {} : { intent: action.intent }), rowId: action.rowId, actionId: action.actionId, subjectId: action.subjectId, label: action.label, description: action.description, acknowledgmentLabel: action.acknowledgmentLabel, confirmation: action.confirmation, ...(context === undefined ? {} : { context }), ...(fields === undefined ? {} : { fields }) }] : [];
    });
    rowIdKey = value.rowIdKey;
  } else if (value.rowIdKey !== undefined) throw safeFallback(copy);
  return { providerId, title: value.title, description: value.description, columns, items, truncated: value.truncated,
    ...(summaryColumnKeys === undefined ? {} : { summaryColumnKeys: [...summaryColumnKeys] }),
    ...(rowIdKey === undefined ? {} : { rowIdKey }), ...(actions === undefined ? {} : { actions }) };
}

function safeActionContext(value: PlatformPublicationAction['context'], policy: RootEvidencePolicy, copy: RootEvidenceCopy): PlatformPublicationAction['context'] {
  const maxEvidenceCellCharacters = evidenceCellCharacters(policy);
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > policy.contextCount) throw safeFallback(copy);
  return value.map(item => {
    if (!item || typeof item !== 'object' || typeof item.label !== 'string' || !item.label.trim() || item.label.length > policy.labelCharacters ||
      typeof item.value !== 'string' || !item.value.trim() || item.value.length > maxEvidenceCellCharacters ||
      /[\u0000-\u001f\u007f]/.test(item.label) || /[\u0000-\u001f\u007f]/.test(item.value)) throw safeFallback(copy);
    return { label: item.label.trim(), value: item.value.trim() };
  });
}

function safeActionFields(value: PlatformPublicationActionField[] | undefined, policy: RootEvidencePolicy, copy: RootEvidenceCopy): PlatformPublicationActionField[] | undefined {
  if (value === undefined) return undefined;
  const maxEvidenceCellCharacters = evidenceCellCharacters(policy);
  if (!Array.isArray(value) || value.length > policy.fieldCount) throw safeFallback(copy);
  const keys = new Set<string>();
  return value.map(field => {
    if (!field || typeof field !== 'object' || !new RegExp(`^[A-Za-z][A-Za-z0-9_-]{0,${policy.fieldKeyCharacters - 1}}$`).test(field.key) || keys.has(field.key) ||
      typeof field.label !== 'string' || !field.label.trim() || field.label.length > policy.labelCharacters ||
      /[\u0000-\u001f\u007f]/.test(field.label) ||
      typeof field.required !== 'boolean' ||
      field.description !== undefined && (typeof field.description !== 'string' || field.description.length > policy.fieldDescriptionCharacters || /[\u0000-\u0008\u000b\u000e-\u001f\u007f]/.test(field.description))) throw safeFallback(copy);
    keys.add(field.key);
    if (field.kind === 'text') {
      if (!Number.isSafeInteger(field.maxLength) || field.maxLength! < 1 || field.maxLength! > Math.min(maxEvidenceCellCharacters, policy.fieldValueCharacters) || field.options !== undefined) throw safeFallback(copy);
      return { key: field.key, label: field.label, kind: field.kind, required: field.required, maxLength: field.maxLength,
        ...(field.description === undefined ? {} : { description: field.description }) };
    }
    if (field.kind === 'choice') {
      if (!Array.isArray(field.options) || field.options.length < 1 || field.options.length > policy.choiceOptionCount || field.maxLength !== undefined) throw safeFallback(copy);
      const optionValues = new Set<string>();
      const options = field.options.map(option => {
        if (!option || typeof option.value !== 'string' || !new RegExp(`^[A-Za-z0-9_-]{1,${policy.choiceValueCharacters}}$`).test(option.value) || optionValues.has(option.value) ||
          typeof option.label !== 'string' || !option.label.trim() || option.label.length > policy.labelCharacters || /[\u0000-\u001f\u007f]/.test(option.label)) throw safeFallback(copy);
        optionValues.add(option.value);
        return { value: option.value, label: option.label };
      });
      return { key: field.key, label: field.label, kind: field.kind, required: field.required, options,
        ...(field.description === undefined ? {} : { description: field.description }) };
    }
    if (field.kind === 'checkbox') {
      if (field.maxLength !== undefined || field.options !== undefined) throw safeFallback(copy);
      return { key: field.key, label: field.label, kind: field.kind, required: field.required,
        ...(field.description === undefined ? {} : { description: field.description }) };
    }
    throw safeFallback(copy);
  });
}

function safeActionResult(value: PlatformPublicationActionResult, action: PlatformPublicationActionInput, policy: RootEvidencePolicy, copy: RootEvidenceCopy): PlatformPublicationActionResult {
  const maxEvidenceCellCharacters = evidenceCellCharacters(policy);
  if (!value || typeof value !== 'object' || value.actionId !== action.actionId || value.subjectId !== action.subjectId ||
    typeof value.operationId !== 'string' || !value.operationId || value.operationId.length > maxEvidenceCellCharacters ||
    !/^[A-Za-z0-9_-]+$/.test(value.operationId) || !['confirmed', 'attested', 'rejected', 'needs_review'].includes(value.state) ||
    typeof value.ok !== 'boolean' || typeof value.message !== 'string' || !value.message.trim() || value.message.length > policy.messageCharacters || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value.message)) throw unconfirmedAction(copy);
  // Only the module can affirm a matching provider receipt or explicit human report.
  if (['confirmed', 'attested'].includes(value.state) !== value.ok) throw unconfirmedAction(copy);
  return { ok: value.ok, actionId: value.actionId, subjectId: value.subjectId, operationId: value.operationId, state: value.state, message: value.message };
}

function limitPanel(evidence: RootPlatformPublicationEvidencePanel, items: RootPlatformPublicationEvidencePanel['items'], truncated: boolean): RootPlatformPublicationEvidencePanel {
  const visibleIds = evidence.rowIdKey ? new Set(items.map(item => item[evidence.rowIdKey!]).filter((id): id is string => typeof id === 'string')) : null;
  return { ...evidence, items, truncated, ...(visibleIds && evidence.actions ? { actions: evidence.actions.filter(action => visibleIds.has(action.rowId)) } : {}) };
}

/** Read content-free receipt evidence for installed platform modules, including modules currently disabled for customers. */
export async function readRootPlatformPublicationEvidence(userId: string, input: unknown = {}, configuredPolicy?: RootEvidencePolicy, configuredCopy?: RootEvidenceCopy) {
  await requireActiveRoot(userId);
  const copy = configuredCopy ?? await loadRootEvidenceCopy();
  const policy = configuredPolicy ?? await loadRootEvidencePolicy(copy);
  const parsed = readInputSchema(policy).safeParse(input);
  if (!parsed.success) throw new OperationError('invalid_request', copy.choosePlatformAndLimit);
  const { providerId, operationId } = parsed.data;
  const rootLimit = await configuredEvidenceLimit(copy);
  const cap = Math.min(rootLimit, policy.resultCap, parsed.data.resultCap ?? policy.resultCap);
  if (providerId !== undefined) {
    if (!PLATFORM_MODULES.some(module => module.id === providerId)) throw new OperationError('invalid_request', copy.chooseInstalledPlatform);
    const recovery = installedPublicationRecovery(providerId);
    if (!recovery?.readEvidence) throw new OperationError('unavailable', copy.unavailableEvidence);
    try {
      const evidence = safeEvidence(await recovery.readEvidence(operationId, cap + 1), providerId, policy, cap + 1, copy);
      return limitPanel(evidence, evidence.items.slice(0, cap), evidence.truncated || evidence.items.length > cap);
    } catch (error) {
      if (error instanceof OperationError) throw error;
      throw safeFallback(copy);
    }
  }
  if (operationId !== undefined) throw new OperationError('invalid_request', copy.choosePlatformForOperation);

  const providers: RootPlatformPublicationEvidencePanel[] = [];
  let remaining = cap;
  let truncated = false;
  for (const { id } of PLATFORM_MODULES) {
    const recovery = installedPublicationRecovery(id);
    if (!recovery?.readEvidence) continue;
    try {
      const evidence = safeEvidence(await recovery.readEvidence(undefined, Math.max(1, remaining + 1)), id, policy, Math.max(1, remaining + 1), copy);
      const visible = evidence.items.slice(0, remaining);
      const panelTruncated = evidence.truncated || visible.length < evidence.items.length;
      providers.push(limitPanel(evidence, visible, panelTruncated));
      remaining -= visible.length;
      truncated ||= panelTruncated;
    } catch (error) {
      if (error instanceof OperationError) throw error;
      throw safeFallback(copy);
    }
  }
  return { providers, truncated } satisfies RootPlatformPublicationEvidenceResult;
}

/** Dispatch a module-owned Root action. The module rechecks its private locks and exact confirmation. */
export async function runRootPlatformPublicationAction(userId: string, input: unknown) {
  await requireActiveRoot(userId);
  const copy = await loadRootEvidenceCopy();
  const policy = await loadRootEvidencePolicy(copy);
  const parsed = actionInputSchema(policy).safeParse(input);
  if (!parsed.success) throw new OperationError('invalid_request', copy.enterValidAction);
  const { providerId, ...action } = parsed.data;
  if (action.fieldValues && (Object.keys(action.fieldValues).length > policy.fieldCount)) throw new OperationError('invalid_request', copy.enterValidFields);
  if (action.fieldValues && Object.values(action.fieldValues).some(value => typeof value === 'string' && /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value))) throw new OperationError('invalid_request', copy.enterValidFields);
  if (!PLATFORM_MODULES.some(module => module.id === providerId)) throw new OperationError('invalid_request', copy.chooseInstalledPlatform);
  const recovery = installedPublicationRecovery(providerId);
  if (!recovery?.executeRootAction) throw new OperationError('unavailable', copy.actionUnavailable);
  try {
    return safeActionResult(await recovery.executeRootAction(userId, action), action, policy, copy);
  } catch (error) {
    if (error instanceof OperationError) throw error;
    throw new OperationError('upstream_failure', copy.actionResultFailure);
  }
}
