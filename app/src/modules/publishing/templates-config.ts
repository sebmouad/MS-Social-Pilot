import { z } from 'zod';
import { entry } from '@/lib/config/entry';

/** Bounds for the existing workspace-scoped post_templates table (no schema change). */
export const TEMPLATE_DEFAULTS = {
  pageSize: 25, maxPerWorkspace: 500, maxSearchCharacters: 120, labelLimit: 200,
  maxNameCharacters: 120, maxCategoryCharacters: 80, maxBodyCharacters: 5000,
  maxHashtagsCharacters: 1000, maxFirstCommentCharacters: 2000,
  transactionTimeoutMs: 5000, transactionMaxWaitMs: 2000,
} as const;

/** Validated safety ceilings; operational values are supplied by Root. */
export const TEMPLATE_CEILINGS = { search: 500, name: 240, category: 240, body: 20000, hashtags: 5000, firstComment: 10000 } as const;
export const TEMPLATE_CONFIG = [
  entry({ key: 'publishing.templateLabelLimit', group: 'Publishing · Templates', label: 'Template label choices limit', kind: 'number', description: 'Maximum label choices read for template authoring. Larger directories are refused instead of silently hiding labels.', defaultValue: TEMPLATE_DEFAULTS.labelLimit, schema: z.number().int().min(1).max(10000), consumption: 'active' }),
  entry({ key: 'publishing.templatePageSize', group: 'Publishing · Templates', label: 'Template page size', kind: 'number', description: 'Number of reusable post templates shown on one page.', defaultValue: TEMPLATE_DEFAULTS.pageSize, schema: z.number().int().min(5).max(100), consumption: 'active' }),
  entry({ key: 'publishing.templateMaxPerWorkspace', group: 'Publishing · Templates', label: 'Template workspace limit', kind: 'number', description: 'Maximum reusable post templates stored per workspace.', defaultValue: TEMPLATE_DEFAULTS.maxPerWorkspace, schema: z.number().int().min(1).max(10000), consumption: 'active' }),
  entry({ key: 'publishing.templateSearchMaxCharacters', group: 'Publishing · Templates', label: 'Template search limit', kind: 'number', description: 'Maximum characters in one template search query.', defaultValue: TEMPLATE_DEFAULTS.maxSearchCharacters, schema: z.number().int().min(10).max(500), consumption: 'active' }),
  entry({ key: 'publishing.templateNameMaxCharacters', group: 'Publishing · Templates', label: 'Template name limit', kind: 'number', description: 'Maximum characters in a reusable post template name.', defaultValue: TEMPLATE_DEFAULTS.maxNameCharacters, schema: z.number().int().min(1).max(240), consumption: 'active' }),
  entry({ key: 'publishing.templateCategoryMaxCharacters', group: 'Publishing · Templates', label: 'Template category limit', kind: 'number', description: 'Maximum characters in a reusable post template category.', defaultValue: TEMPLATE_DEFAULTS.maxCategoryCharacters, schema: z.number().int().min(1).max(240), consumption: 'active' }),
  entry({ key: 'publishing.templateBodyMaxCharacters', group: 'Publishing · Templates', label: 'Template message limit', kind: 'number', description: 'Maximum characters in reusable post message content.', defaultValue: TEMPLATE_DEFAULTS.maxBodyCharacters, schema: z.number().int().min(1).max(20000), consumption: 'active' }),
  entry({ key: 'publishing.templateHashtagsMaxCharacters', group: 'Publishing · Templates', label: 'Template hashtags limit', kind: 'number', description: 'Maximum characters in reusable hashtags.', defaultValue: TEMPLATE_DEFAULTS.maxHashtagsCharacters, schema: z.number().int().min(0).max(5000), consumption: 'active' }),
  entry({ key: 'publishing.templateFirstCommentMaxCharacters', group: 'Publishing · Templates', label: 'Template first comment limit', kind: 'number', description: 'Maximum characters in reusable first-comment content.', defaultValue: TEMPLATE_DEFAULTS.maxFirstCommentCharacters, schema: z.number().int().min(0).max(10000), consumption: 'active' }),
  entry({ key: 'publishing.templateTransactionTimeoutMs', group: 'Publishing · Templates', label: 'Template transaction timeout', kind: 'number', description: 'Maximum duration of one template mutation transaction.', defaultValue: TEMPLATE_DEFAULTS.transactionTimeoutMs, schema: z.number().int().min(500).max(30000), consumption: 'active' }),
  entry({ key: 'publishing.templateTransactionMaxWaitMs', group: 'Publishing · Templates', label: 'Template transaction wait', kind: 'number', description: 'Maximum wait for a template mutation transaction slot.', defaultValue: TEMPLATE_DEFAULTS.transactionMaxWaitMs, schema: z.number().int().min(100).max(10000), consumption: 'active' }),
] as const;
