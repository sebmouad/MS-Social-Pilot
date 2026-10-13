/**
 * @mentions in internal notes, the parts the note box and the
 * server share. Plain module: no database.
 */

export const NOTE_MAX = 2000;

/** The name being typed after an `@` that ends right at the caret, or null. */
export function mentionQuery(textBeforeCaret: string): string | null {
  const match = /(?:^|\s)@([\p{L}\p{N}._'-]*(?: [\p{L}\p{N}._'-]*)?)$/u.exec(textBeforeCaret);
  return match ? match[1]! : null;
}

/** Members whose name starts with the query (or a word in it does), at most five. */
export function mentionMatches<T extends { name: string }>(members: T[], query: string): T[] {
  const wanted = query.trim().toLowerCase();
  return members
    .filter((member) => {
      const name = member.name.toLowerCase();
      return !wanted || name.startsWith(wanted) || name.split(/\s+/).some((word) => word.startsWith(wanted));
    })
    .slice(0, 5);
}

/** Of the ids the note box sent, those whose `@Name` really is in the text. */
export function mentionedIn<T extends { id: string; name: string }>(body: string, members: T[], ids: string[]): string[] {
  return members.filter((member) => ids.includes(member.id) && body.includes(`@${member.name}`)).map((member) => member.id);
}
