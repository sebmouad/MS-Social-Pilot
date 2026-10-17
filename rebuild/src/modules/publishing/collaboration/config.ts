import { z } from 'zod';
import { entry } from '@/lib/config/entry';

/**
 * Bounds for post collaboration (assignments, fields, notes, versions, queue
 * times, content mix, recycling). Defaults are the Root registry defaults; the
 * services read the live values through `runtimeConfig` and refuse to run when
 * a value is missing or invalid.
 */
export const COLLAB_DEFAULTS = {
  bulkPostLimit: 50, labelsPerPostLimit: 20,
  fieldLimit: 20, fieldNameMax: 60, fieldOptionMax: 60, fieldOptionsLimit: 30, fieldValueMax: 500,
  mentionDirectoryLimit: 200, noteMax: 2000, notePageSize: 50, noteMentionLimit: 20, notesPerPostLimit: 500,
  versionPageSize: 25, versionRetention: 50,
  queueSlotLimit: 100,
  mixRulesPerScope: 30, mixMaxPerWeek: 50, mixWindowDays: 7,
  recycleMaxIntervalDays: 365, recycleMaxRepeats: 1000, recycleDefaultIntervalDays: 30, variantsLimit: 10, variantMaxCharacters: 5000,
  executorBatchSize: 50, queueLookaheadDays: 30,
  transactionTimeoutMs: 5000, transactionMaxWaitMs: 2000,
} as const;

export type CollabBounds = { -readonly [K in keyof typeof COLLAB_DEFAULTS]: number };

const G = 'Publishing · Collaboration';
const n = (min: number, max: number) => z.number().int().min(min).max(max);
/** key suffix -> [bounds key, label, description, min, max] */
const rows: ReadonlyArray<readonly [keyof typeof COLLAB_DEFAULTS, string, string, number, number]> = [
  ['bulkPostLimit', 'Bulk label post limit', 'Maximum posts changed by one bulk label action.', 1, 500],
  ['labelsPerPostLimit', 'Labels per post limit', 'Maximum labels on a single post.', 1, 100],
  ['fieldLimit', 'Custom field limit', 'Maximum custom fields per workspace.', 1, 200],
  ['fieldNameMax', 'Custom field name limit', 'Maximum characters in a custom field name.', 1, 120],
  ['fieldOptionMax', 'Custom field option limit', 'Maximum characters in one choice option.', 1, 120],
  ['fieldOptionsLimit', 'Custom field options per field', 'Maximum options on one choice field.', 2, 100],
  ['fieldValueMax', 'Custom field value limit', 'Maximum characters in a custom field value.', 1, 2000],
  ['mentionDirectoryLimit', 'Mention directory limit', 'Maximum eligible members read for a post note. Oversized directories are refused.', 1, 5000],
  ['noteMax', 'Post note length', 'Maximum characters in one internal post note.', 1, 10000],
  ['notePageSize', 'Post notes page size', 'Notes shown per page on a post.', 5, 200],
  ['noteMentionLimit', 'Post note mention limit', 'Maximum members mentioned in one note.', 1, 50],
  ['notesPerPostLimit', 'Post notes per post limit', 'Maximum internal notes kept on one post.', 10, 5000],
  ['versionPageSize', 'Post version page size', 'Versions shown per page.', 5, 100],
  ['versionRetention', 'Post versions kept', 'Versions kept per post; the oldest are removed first.', 5, 500],
  ['queueSlotLimit', 'Queue times per timetable', 'Maximum weekly queue times in one shared or channel timetable.', 1, 500],
  ['mixRulesPerScope', 'Content mix rules per scope', 'Maximum label rules for one channel or group.', 1, 100],
  ['mixMaxPerWeek', 'Content mix posts per week', 'Maximum weekly posts a single mix rule may ask for.', 1, 500],
  ['mixWindowDays', 'Content mix window (days)', 'Rolling window used to count planned posts against a mix.', 1, 31],
  ['recycleMaxIntervalDays', 'Recycle maximum interval (days)', 'Longest allowed gap between repeats of a post.', 1, 3650],
  ['recycleMaxRepeats', 'Recycle maximum repeats', 'Highest repeat limit that can be set on a post.', 1, 10000],
  ['recycleDefaultIntervalDays', 'Recycle default interval (days)', 'Interval used when none is chosen.', 1, 3650],
  ['variantsLimit', 'Recycle wordings limit', 'Maximum alternate wordings on one post.', 1, 50],
  ['variantMaxCharacters', 'Recycle wording length', 'Maximum characters in one alternate wording.', 1, 20000],
  ['executorBatchSize', 'Collaboration worker batch size', 'Maximum recycle repeats or content-mix workspaces handled per worker tick.', 1, 500],
  ['queueLookaheadDays', 'Queue look-ahead (days)', 'How far ahead a queue time may be allocated when filling a content mix.', 1, 120],
  ['transactionTimeoutMs', 'Collaboration transaction timeout', 'Maximum duration of one collaboration mutation.', 500, 30000],
  ['transactionMaxWaitMs', 'Collaboration transaction wait', 'Maximum wait for a collaboration mutation slot.', 100, 10000],
];

const EXECUTION_POLICY = new Set<keyof CollabBounds>(['versionRetention', 'queueSlotLimit', 'mixRulesPerScope', 'mixMaxPerWeek', 'mixWindowDays', 'recycleMaxIntervalDays', 'recycleMaxRepeats', 'recycleDefaultIntervalDays', 'variantsLimit', 'variantMaxCharacters', 'executorBatchSize', 'queueLookaheadDays']);
/** Outer input safety ceilings follow the same registry declarations; live values are enforced by services. */
export const COLLAB_INPUT_CEILINGS = Object.fromEntries(rows.map(([key, , , , max]) => [key, max])) as CollabBounds;
export const COLLAB_CONFIG = rows.map(([key, label, description, min, max]) => entry({
  key: `publishing.collab.${key}`, group: G, label, kind: 'number', description,
  defaultValue: COLLAB_DEFAULTS[key], schema: n(min, max), consumption: EXECUTION_POLICY.has(key) ? 'planned' : 'active',
}));
export const COLLAB_KEYS = rows.map(([key]) => key);
