import { z } from 'zod';
import { entry } from '@/lib/config/entry';

/** Bounds for the existing workspace-scoped labels table (no schema change). */
export const LABEL_DEFAULTS = {
  pageSize: 50, maxPerWorkspace: 200, maxSearchCharacters: 120, maxNameCharacters: 60,
  transactionTimeoutMs: 5000, transactionMaxWaitMs: 2000,
} as const;

/** Hard ceilings mirrored from the Root setting schemas; runtime values may be lower. */
export const LABEL_BOUNDS = {
  pageSize: { min: 5, max: 200 }, maxPerWorkspace: { min: 1, max: 5000 },
  maxSearchCharacters: { min: 10, max: 500 }, maxNameCharacters: { min: 1, max: 120 },
  transactionTimeoutMs: { min: 500, max: 30000 }, transactionMaxWaitMs: { min: 100, max: 10000 },
  workspaceTimeoutMs: { min: 5000, max: 3600000 },
} as const;

/** Colour tokens stored in labels.color; legacy default is `blue`. Presentation vocabulary, not operational policy. */
export const LABEL_COLORS = ['blue', 'green', 'teal', 'purple', 'pink', 'red', 'orange', 'yellow', 'gray'] as const;

export const LABEL_CONFIG = [
  entry({ key: 'publishing.labelPageSize', group: 'Publishing · Labels', label: 'Label page size', kind: 'number', description: 'Number of post labels shown on one page.', defaultValue: LABEL_DEFAULTS.pageSize, schema: z.number().int().min(LABEL_BOUNDS.pageSize.min).max(LABEL_BOUNDS.pageSize.max), consumption: 'active' }),
  entry({ key: 'publishing.labelMaxPerWorkspace', group: 'Publishing · Labels', label: 'Label workspace limit', kind: 'number', description: 'Maximum post labels stored per workspace.', defaultValue: LABEL_DEFAULTS.maxPerWorkspace, schema: z.number().int().min(LABEL_BOUNDS.maxPerWorkspace.min).max(LABEL_BOUNDS.maxPerWorkspace.max), consumption: 'active' }),
  entry({ key: 'publishing.labelSearchMaxCharacters', group: 'Publishing · Labels', label: 'Label search limit', kind: 'number', description: 'Maximum characters in one label search query.', defaultValue: LABEL_DEFAULTS.maxSearchCharacters, schema: z.number().int().min(LABEL_BOUNDS.maxSearchCharacters.min).max(LABEL_BOUNDS.maxSearchCharacters.max), consumption: 'active' }),
  entry({ key: 'publishing.labelNameMaxCharacters', group: 'Publishing · Labels', label: 'Label name limit', kind: 'number', description: 'Maximum characters in a post label name.', defaultValue: LABEL_DEFAULTS.maxNameCharacters, schema: z.number().int().min(LABEL_BOUNDS.maxNameCharacters.min).max(LABEL_BOUNDS.maxNameCharacters.max), consumption: 'active' }),
  entry({ key: 'publishing.labelTransactionTimeoutMs', group: 'Publishing · Labels', label: 'Label transaction timeout', kind: 'number', description: 'Maximum duration of one label mutation transaction.', defaultValue: LABEL_DEFAULTS.transactionTimeoutMs, schema: z.number().int().min(LABEL_BOUNDS.transactionTimeoutMs.min).max(LABEL_BOUNDS.transactionTimeoutMs.max), consumption: 'active' }),
  entry({ key: 'publishing.labelTransactionMaxWaitMs', group: 'Publishing · Labels', label: 'Label transaction wait', kind: 'number', description: 'Maximum wait for a label mutation transaction slot.', defaultValue: LABEL_DEFAULTS.transactionMaxWaitMs, schema: z.number().int().min(LABEL_BOUNDS.transactionMaxWaitMs.min).max(LABEL_BOUNDS.transactionMaxWaitMs.max), consumption: 'active' }),
] as const;
