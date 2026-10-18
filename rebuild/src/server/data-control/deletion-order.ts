/** A foreign key from `child` to `parent`, as reported by the PostgreSQL catalog. */
export type TableDependency = { child: string; parent: string };

/**
 * Order tables so every child is deleted before the parent it references.
 * Only edges between the given tables matter: other parents are not deleted here.
 * Self references and duplicate edges are ignored. Ties break alphabetically so the
 * order is deterministic. An unresolved cycle throws instead of guessing, because
 * the caller must not bypass the write-gate triggers to break it.
 */
export function orderTablesForDeletion(tables: readonly string[], dependencies: readonly TableDependency[]): string[] {
  const names = [...new Set(tables)].sort();
  const known = new Set(names);
  const blockers = new Map<string, Set<string>>(names.map(name => [name, new Set<string>()]));
  for (const { child, parent } of dependencies) {
    // A parent can only be deleted once every child that references it is gone.
    if (child === parent || !known.has(child) || !known.has(parent)) continue;
    blockers.get(parent)!.add(child);
  }
  const ordered: string[] = [];
  const remaining = new Set(names);
  while (remaining.size) {
    const next = names.find(name => remaining.has(name) && [...blockers.get(name)!].every(child => !remaining.has(child)));
    if (!next) {
      throw new Error(`Workspace data erasure cannot order circular table dependencies: ${[...remaining].join(', ')}. No data was deleted.`);
    }
    ordered.push(next);
    remaining.delete(next);
  }
  return ordered;
}
