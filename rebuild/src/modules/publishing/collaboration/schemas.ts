import { z } from 'zod';
import { COLLAB_INPUT_CEILINGS as D } from './config';

/** Pure contracts shared by services, routes, MCP and screens. No database or provider knowledge. */
const clean = (max: number) => z.string().trim().max(max).refine(v => !/[\u0000-\u001f\u007f]/.test(v), 'Control characters are not allowed.');
const multiline = (max: number) => z.string().trim().max(max).refine(v => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v), 'Control characters are not allowed.');
export const ID = z.string().min(1).max(80).regex(/^[A-Za-z0-9_:-]+$/);
const ids = (max: number, min = 0) => z.array(ID).min(min).max(max).refine(list => new Set(list).size === list.length, 'Each item once.');

// ---- label assignment -------------------------------------------------------
export const ASSIGN_MODES = ['add', 'remove', 'set'] as const;
export const ASSIGN_SCHEMA = z.object({ postIds: ids(500, 1), labelIds: ids(100), mode: z.enum(ASSIGN_MODES), confirmation: z.string() }).strict()
  .refine(v => v.mode === 'set' || v.labelIds.length > 0, 'Choose at least one label.');
export const assignConfirmation = (mode: string, postCount: number) => `${mode.toUpperCase()} LABELS ON ${postCount} POST${postCount === 1 ? '' : 'S'}`;

// ---- custom fields ----------------------------------------------------------
export const FIELD_KINDS = ['text', 'choice'] as const;
const fieldShape = {
  name: clean(D.fieldNameMax).refine(v => v.length > 0, 'Enter a name.'),
  kind: z.enum(FIELD_KINDS),
  options: z.array(clean(D.fieldOptionMax).refine(v => v.length > 0)).max(D.fieldOptionsLimit).default([]),
};
const fieldRule = (f: { kind: string; options: string[] }) => f.kind === 'text' ? f.options.length === 0 : new Set(f.options).size >= 2;
const FIELD_MESSAGE = 'A choice field needs at least two different options; a text field has none.';
export const FIELD_CREATE = z.object({ ...fieldShape, confirmation: z.string() }).strict().refine(fieldRule, FIELD_MESSAGE);
export const FIELD_UPDATE = z.object({ id: ID, ...fieldShape, confirmation: z.string() }).strict().refine(fieldRule, FIELD_MESSAGE);
export const FIELD_DELETE = z.object({ id: ID, confirmation: z.string() }).strict();
export const FIELD_VALUES = z.object({ postId: ID, values: z.record(ID, z.string().max(D.fieldValueMax)), confirmation: z.string() }).strict();
export const createFieldConfirmation = (name: string) => `CREATE FIELD ${name.trim()}`;
export const updateFieldConfirmation = (id: string) => `UPDATE FIELD ${id}`;
export const deleteFieldConfirmation = (id: string) => `DELETE FIELD ${id}`;
export const setFieldValuesConfirmation = (postId: string) => `SET POST FIELDS ${postId}`;
export const dedupeOptions = (options: readonly string[]) => [...new Set(options)];

// ---- notes ------------------------------------------------------------------
export const NOTE_ADD = z.object({ postId: ID, body: multiline(D.noteMax).refine(v => v.length > 0, 'Write a note.'), mentionIds: ids(D.noteMentionLimit).default([]), confirmation: z.string() }).strict();
export const NOTE_DELETE = z.object({ noteId: ID, confirmation: z.string() }).strict();
export const NOTE_LIST = z.object({ postId: ID, page: z.number().int().min(1).max(100000).optional() }).strict();
export const addNoteConfirmation = (postId: string) => `ADD NOTE ${postId}`;
export const deleteNoteConfirmation = (noteId: string) => `DELETE NOTE ${noteId}`;
/** Of the ids the note box sent, those whose `@Name` really appears in the text as a whole mention
 * (not a prefix of a longer word or of a longer member name that also matches there). */
export function mentionedIn<T extends { id: string; name: string }>(body: string, members: readonly T[], requested: readonly string[]): string[] {
  const wanted = members.filter(m => requested.includes(m.id) && m.name.length > 0);
  const found = new Set<string>();
  for (const m of wanted) {
    const needle = `@${m.name}`;
    for (let at = body.indexOf(needle); at !== -1; at = body.indexOf(needle, at + 1)) {
      const next = body.charAt(at + needle.length);
      if (next && /[\p{L}\p{N}_]/u.test(next)) continue;
      // A longer member name matching at the same position owns the mention.
      const longer = members.some(o => o.id !== m.id && o.name.length > m.name.length && o.name.startsWith(m.name) && body.startsWith(`@${o.name}`, at) && !/[\p{L}\p{N}_]/u.test(body.charAt(at + 1 + o.name.length)));
      if (!longer) { found.add(m.id); break; }
    }
  }
  return members.filter(m => found.has(m.id)).map(m => m.id);
}

// ---- versions ---------------------------------------------------------------
export const VERSION_LIST = z.object({ postId: ID, page: z.number().int().min(1).max(100000).optional() }).strict();
export const VERSION_RESTORE = z.object({ postId: ID, versionId: ID, confirmation: z.string() }).strict();
export const restoreVersionConfirmation = (versionId: string) => `RESTORE VERSION ${versionId}`;

// ---- queue times ------------------------------------------------------------
export const SLOT = z.object({ dayOfWeek: z.number().int().min(0).max(6), hour: z.number().int().min(0).max(23), minute: z.number().int().min(0).max(59) }).strict();
export const SLOTS_READ = z.object({ targetId: ID.optional() }).strict();
export const SLOTS_REPLACE = z.object({ targetId: ID.nullable(), slots: z.array(SLOT).max(500), confirmation: z.string() }).strict();
export const replaceSlotsConfirmation = (targetId: string | null) => `REPLACE QUEUE TIMES ${targetId ?? 'SHARED'}`;
export const slotKey = (s: { dayOfWeek: number; hour: number; minute: number }) => `${s.dayOfWeek}-${s.hour}-${s.minute}`;

// ---- content mix ------------------------------------------------------------
export const MIX_SAVE = z.object({
  scope: z.object({ targetId: ID.optional(), groupId: ID.optional() }).strict().refine(s => Boolean(s.targetId) !== Boolean(s.groupId), 'Choose a channel or a group.'),
  rules: z.array(z.object({ labelId: ID, perWeek: z.number().int().min(1).max(500) }).strict()).max(100).refine(r => new Set(r.map(x => x.labelId)).size === r.length, 'Each label once.'),
  confirmation: z.string(),
}).strict();
export const saveMixConfirmation = (scope: { targetId?: string; groupId?: string }) => `SAVE CONTENT MIX ${scope.targetId ?? scope.groupId ?? ''}`;
type MixRule = { id: string; targetId: string | null; groupId: string | null; labelId: string; perWeek: number };
/** A channel follows its own rules when it has any, otherwise its groups' rules (larger number wins per label). */
export function effectiveMix<R extends MixRule>(rules: readonly R[], targetIds: readonly string[], groupsOf: ReadonlyMap<string, readonly string[]>) {
  const out = new Map<string, Map<string, { perWeek: number; rules: R[] }>>();
  for (const targetId of targetIds) {
    const own = rules.filter(r => r.targetId === targetId);
    const groups = groupsOf.get(targetId) ?? [];
    const source = own.length ? own : rules.filter(r => r.groupId && groups.includes(r.groupId));
    if (!source.length) continue;
    const mix = new Map<string, { perWeek: number; rules: R[] }>();
    for (const rule of source) { const e = mix.get(rule.labelId) ?? { perWeek: 0, rules: [] }; e.perWeek = Math.max(e.perWeek, rule.perWeek); e.rules.push(rule); mix.set(rule.labelId, e); }
    out.set(targetId, mix);
  }
  return out;
}

// ---- recycling --------------------------------------------------------------
export const RECYCLE_READ = z.object({ postId: ID }).strict();
export const RECYCLE_SET = z.object({
  postId: ID, enabled: z.boolean(),
  everyDays: z.number().int().min(1).max(3650).optional(),
  limit: z.number().int().min(1).max(10000).nullable().optional(),
  variants: z.array(multiline(20000).refine(v => v.length > 0)).max(50).optional(),
  confirmation: z.string(),
}).strict();
export const setRecycleConfirmation = (postId: string) => `SET RECYCLE ${postId}`;
/** Next repeat strictly after `now`, staying on the original cadence; null when the run is finished. */
export function nextRecycleAt(o: { everyDays: number | null; limit: number | null; count: number; from: Date; now?: Date }): Date | null {
  if (!o.everyDays || o.everyDays < 1) return null;
  if (o.limit !== null && o.count >= o.limit) return null;
  const interval = o.everyDays * 86_400_000;
  const behind = o.now ? o.now.getTime() - o.from.getTime() : -1;
  const steps = behind < 0 ? 1 : Math.floor(behind / interval) + 1;
  return new Date(o.from.getTime() + steps * interval);
}
