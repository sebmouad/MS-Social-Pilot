/** A foreign key from `child` to `parent`, as reported by the PostgreSQL catalog. */
export type TableDependency = { child: string; parent: string };

/**
 * Order tables so every child is deleted before the parent it references.
 * A child that reaches a parent only through other tables (for example posts ->
 * feed_items -> feed_sources, where deleting a source cascades into the items and
 * then nulls the posts) still has to go first, so dependencies are followed through
 * tables that are not in the given set. Other parents are never deleted here.
 * Self references and duplicate edges are ignored. Ties break alphabetically so the
 * order is deterministic. An unresolved cycle throws instead of guessing, because
 * the caller must not bypass the write-gate triggers to break it.
 */
export function orderTablesForDeletion(tables: readonly string[], dependencies: readonly TableDependency[]): string[] {
  const names = [...new Set(tables)].sort();
  const known = new Set(names);
  const parentsOf = new Map<string, Set<string>>();
  for (const { child, parent } of dependencies) {
    if (child === parent) continue;
    if (!parentsOf.has(child)) parentsOf.set(child, new Set());
    parentsOf.get(child)!.add(parent);
  }
  const blockers = new Map<string, Set<string>>(names.map(name => [name, new Set<string>()]));
  for (const child of names) {
    // Walk every table this child can reach; a listed table reached this way cannot be deleted before the child.
    const seen = new Set<string>([child]);
    const queue = [child];
    while (queue.length) {
      for (const parent of parentsOf.get(queue.shift()!) ?? []) {
        if (seen.has(parent)) continue;
        seen.add(parent);
        queue.push(parent);
        if (known.has(parent)) blockers.get(parent)!.add(child);
      }
    }
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
