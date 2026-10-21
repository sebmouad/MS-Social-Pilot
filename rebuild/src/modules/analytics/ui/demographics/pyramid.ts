/**
 * Reads neutral breakdown rows that name an age range and a gender ("F.25-34", "Women 25–34", "male · 65+").
 * Only the shape of the label is interpreted, never a provider key. A breakdown that does not fit
 * completely is not drawn as a pyramid, so the caller falls back to plain bars.
 */
export type PyramidModel = { groups: string[]; left: Array<number | null>; right: Array<number | null> };

const LEFT = new Set(['f', 'female', 'females', 'woman', 'women', 'femme', 'femmes']);
const RIGHT = new Set(['m', 'male', 'males', 'man', 'men', 'homme', 'hommes']);
const AGE = /(\d{1,3})\s*(?:[-–—]\s*(\d{1,3})|\+)/;

export function parseAgeGender(label: string): { age: string; from: number; side: 'left' | 'right' } | null {
  const match = AGE.exec(label);
  if (!match) return null;
  const rest = label.replace(match[0], ' ').toLowerCase();
  const words = rest.split(/[^a-zà-ÿ]+/i).filter(Boolean);
  const side = words.some(word => LEFT.has(word)) ? 'left' : words.some(word => RIGHT.has(word)) ? 'right' : null;
  if (!side) return null;
  const from = Number(match[1]);
  return { age: match[2] ? `${from}–${match[2]}` : `${from}+`, from, side };
}

export function buildPyramid(rows: ReadonlyArray<{ label: string; value: number | null }>): PyramidModel | null {
  const cells = new Map<string, { from: number; left: number | null; right: number | null }>();
  for (const row of rows) {
    const parsed = parseAgeGender(row.label);
    if (!parsed) return null;
    const cell = cells.get(parsed.age) ?? { from: parsed.from, left: null, right: null };
    if (row.value !== null && Number.isFinite(row.value)) cell[parsed.side] = (cell[parsed.side] ?? 0) + row.value;
    cells.set(parsed.age, cell);
  }
  if (cells.size < 2) return null;
  const ordered = [...cells].sort(([, a], [, b]) => a.from - b.from);
  return { groups: ordered.map(([age]) => age), left: ordered.map(([, cell]) => cell.left), right: ordered.map(([, cell]) => cell.right) };
}
