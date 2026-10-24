export type CsvDestination = { id: string; name: string; type: string; provider: string | null };

/** A readable, stable-enough label for one import session; IDs stay server-side. */
export function csvDestinationLabel(target: CsvDestination): string {
  return `${target.provider ?? 'Connected platform'} / ${target.type} / ${target.name}`;
}

export function resolveCsvDestinationIds(cell: string, targets: readonly CsvDestination[], rowNumber: number): string[] {
  const names = cell.split(';').map(value => value.trim()).filter(Boolean);
  const labels = new Map<string, string[]>();
  for (const target of targets) {
    const label = csvDestinationLabel(target).toLocaleLowerCase();
    labels.set(label, [...(labels.get(label) ?? []), target.id]);
  }
  return names.map(name => {
    const ids = labels.get(name.toLocaleLowerCase()) ?? [];
    if (ids.length !== 1) throw new Error(`CSV row ${rowNumber}: channel “${name}” is ${ids.length ? 'ambiguous' : 'unavailable'}. Use an exact channel label shown in the import form.`);
    return ids[0]!;
  });
}
