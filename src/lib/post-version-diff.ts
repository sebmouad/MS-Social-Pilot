/**
 * Post version history (NEXT_PHASES H9), the parts the composer shows. Plain
 * module: no database.
 */

/** One saved version as the composer receives it. */
export interface PostVersionView {
  id: string;
  createdAt: string;
  authorName: string | null;
  message: string;
  firstComment: string | null;
  link: string | null;
  /** Media items as stored on the post (PostMedia[]). */
  media: unknown[];
  format: string;
  targetIds: string[];
  labelIds: string[];
  /** `datetime-local` value in the workspace's zone, or null for a draft. */
  scheduledAtLocal: string | null;
}

export type VersionField = 'text' | 'firstComment' | 'link' | 'media' | 'format' | 'pages' | 'labels' | 'time';

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((value) => b.includes(value));

/** What differs between two versions, in the order the composer lists it. */
export function changedFields(before: PostVersionView, after: PostVersionView): VersionField[] {
  const fields: VersionField[] = [];
  if (before.message !== after.message) fields.push('text');
  if ((before.firstComment ?? '') !== (after.firstComment ?? '')) fields.push('firstComment');
  if ((before.link ?? '') !== (after.link ?? '')) fields.push('link');
  if (JSON.stringify(before.media) !== JSON.stringify(after.media)) fields.push('media');
  if (before.format !== after.format) fields.push('format');
  if (!sameSet(before.targetIds, after.targetIds)) fields.push('pages');
  if (!sameSet(before.labelIds, after.labelIds)) fields.push('labels');
  if (before.scheduledAtLocal !== after.scheduledAtLocal) fields.push('time');
  return fields;
}

export interface DiffPart {
  kind: 'same' | 'added' | 'removed';
  text: string;
}

/** Past this many words a side, the diff is shown as one block removed and one added. */
const MAX_WORDS = 1500;

/**
 * Word-level difference from `before` to `after`, whitespace kept with the word
 * before it so joining the parts of one side gives that side back.
 */
export function wordDiff(before: string, after: string): DiffPart[] {
  const a = before.match(/\S+\s*|\s+/g) ?? [];
  const b = after.match(/\S+\s*|\s+/g) ?? [];
  if (a.length > MAX_WORDS || b.length > MAX_WORDS) {
    return [
      ...(before ? [{ kind: 'removed' as const, text: before }] : []),
      ...(after ? [{ kind: 'added' as const, text: after }] : []),
    ];
  }
  // Longest common subsequence, filled from the end so the walk goes forward.
  const table = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i]![j] = a[i] === b[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }
  const parts: DiffPart[] = [];
  const push = (kind: DiffPart['kind'], text: string) => {
    const last = parts[parts.length - 1];
    if (last?.kind === kind) last.text += text;
    else parts.push({ kind, text });
  };
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      push('same', a[i]!);
      i += 1;
      j += 1;
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) {
      push('removed', a[i]!);
      i += 1;
    } else {
      push('added', b[j]!);
      j += 1;
    }
  }
  while (i < a.length) push('removed', a[i++]!);
  while (j < b.length) push('added', b[j++]!);
  return parts;
}
