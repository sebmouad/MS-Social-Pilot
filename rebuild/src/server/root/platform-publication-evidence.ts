import { z } from 'zod';
import { OperationError } from '@/lib/operation-error';
import { installedPublicationRecovery } from '@/server/platforms/publication-recovery';
import { PLATFORM_MODULES } from '@/platforms';
import { runtimeConfig } from '@/server/config/store';
import { requireActiveRoot } from './operations';
import type { PlatformPublicationEvidence } from '@/server/platforms/host';

const inputSchema = z.object({
  providerId: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/).optional(),
  operationId: z.string().regex(/^[A-Za-z0-9_-]{1,200}$/).optional(),
  resultCap: z.number().int().safe().min(1).max(1000).optional(),
}).strict();

export type RootPlatformPublicationEvidencePanel = PlatformPublicationEvidence & { providerId: string };
export type RootPlatformPublicationEvidenceResult = RootPlatformPublicationEvidencePanel | {
  providers: RootPlatformPublicationEvidencePanel[];
  truncated: boolean;
};

const safeFallback = () => new OperationError('upstream_failure', 'Platform publication evidence could not be loaded.');
// Platform receipt identifiers are accepted up to this same integrity bound.
const maxEvidenceCellCharacters = 2048;
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
  return { providerId, title: value.title, description: value.description, columns, items, truncated: value.truncated };
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
      return { ...evidence, items: evidence.items.slice(0, cap), truncated: evidence.truncated || evidence.items.length > cap };
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
      providers.push({ ...evidence, items: visible, truncated: panelTruncated });
      remaining -= visible.length;
      truncated ||= panelTruncated;
    } catch (error) {
      if (error instanceof OperationError) throw error;
      throw safeFallback();
    }
  }
  return { providers, truncated } satisfies RootPlatformPublicationEvidenceResult;
}
