import type { AdsDailyRow } from '@/modules/ads/report-data';
export type Observation = Omit<AdsDailyRow, 'spend' | 'impressions' | 'clicks' | 'reach'> & { parentId: string | null; spend: number | null; impressions: number | null; clicks: number | null; reach: number | null };
const finite = (v: number | null) => v !== null && Number.isFinite(v);
export function aggregateObjects(rows: readonly Observation[], requestedDays: number) {
  const groups = new Map<string, Observation[]>();
  for (const row of rows) {
    const key = JSON.stringify([row.accountId, row.level, row.objectId, row.currency]);
    const group = groups.get(key) ?? []; group.push(row); groups.set(key, group);
  }
  return [...groups.entries()].map(([key, group]) => {
    // A stored object-day is one observation, even if it was fetched repeatedly.
    const days = new Map<string, Observation>();
    for (const row of [...group].sort((a, b) => (a.fetchedAt ?? '').localeCompare(b.fetchedAt ?? '') || a.id.localeCompare(b.id))) days.set(row.date, row);
    const daily = [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
    const latest = daily[daily.length - 1]!;
    const sum = (field: 'spend' | 'impressions' | 'clicks') => daily.every(row => finite(row[field])) ? daily.reduce((total, row) => total + row[field]!, 0) : null;
    const spend = sum('spend'), impressions = sum('impressions'), clicks = sum('clicks');
    const ratio = (n: number | null, d: number | null, factor = 1) => n !== null && d !== null && d > 0 ? n / d * factor : null;
    const fetches = daily.flatMap(row => row.fetchedAt ? [row.fetchedAt] : []).sort();
    return { key, accountId: latest.accountId, accountName: latest.accountName, currency: latest.currency, level: latest.level, objectId: latest.objectId, name: latest.objectName || latest.objectId,
      parentId: latest.parentId, parentConsistent: daily.every(row => row.parentId === latest.parentId), spend, impressions, clicks,
      cpc: ratio(spend, clicks), cpm: ratio(spend, impressions, 1000), ctr: ratio(clicks, impressions, 100),
      reach: latest.reach, reachDate: latest.date, frequency: latest.frequency, cpp: latest.cpp,
      coveredDays: daily.length, requestedDays, lastFetchedAt: fetches.at(-1) ?? null, fetchCoverage: fetches.length, daily };
  }).sort((a, b) => a.accountId.localeCompare(b.accountId) || a.name.localeCompare(b.name) || a.key.localeCompare(b.key));
}
export type AdObject = ReturnType<typeof aggregateObjects>[number];
export const AD_OBJECT_SORTS = ['name', 'spend', 'impressions', 'clicks', 'ctr', 'cpc', 'cpm', 'reach', 'coveredDays', 'lastFetchedAt'] as const;
export type AdObjectSort = typeof AD_OBJECT_SORTS[number];
/** Order within each account/currency only. Unknowns stay last in both directions; identity breaks ties before paging. */
export function sortAdObjects(items: readonly AdObject[], sort: AdObjectSort, direction: 'asc' | 'desc'): AdObject[] {
  const sign = direction === 'asc' ? 1 : -1;
  return [...items].sort((a, b) => {
    const group = a.accountId.localeCompare(b.accountId) || (a.currency ?? '').localeCompare(b.currency ?? '');
    if (group) return group;
    const x = a[sort], y = b[sort];
    const tie = () => a.key.localeCompare(b.key);
    if (x === null && y === null) return tie();
    if (x === null) return 1;
    if (y === null) return -1;
    return sign * (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))) || tie();
  });
}
export function adObjectsCsv(items: readonly AdObject[], start: string, end: string, locale: 'en' | 'fr') {
  const missing = locale === 'fr' ? 'Non disponible' : 'Not available';
  const cell = (v: unknown) => { const s = v === null || v === undefined ? missing : typeof v === 'object' ? JSON.stringify(v) : String(v); return `"${(/^[=+\-@\t\r\n]/.test(s) ? "'" : '') + s.replaceAll('"', '""')}"`; };
  const en = ['Kind', 'Start UTC inclusive', 'End UTC inclusive', 'Account', 'Account ID', 'Currency (account metadata)', 'Level', 'Object', 'Object ID', 'Parent ID', 'Covered days', 'Requested days', 'Date UTC', 'Fetched UTC', 'Spend', 'Impressions', 'Clicks', 'Reach snapshot', 'Reach date UTC', 'Cost per click', 'Cost per 1000 impressions', 'Click rate %', 'Frequency snapshot', 'Cost per person snapshot', 'Actions (unaggregated)', 'Additional fields (unaggregated)', 'Redacted paths'];
  const fr = ['Type', 'Début UTC inclus', 'Fin UTC incluse', 'Compte', 'ID du compte', 'Devise (métadonnées du compte)', 'Niveau', 'Objet', 'ID de l’objet', 'ID parent', 'Jours couverts', 'Jours demandés', 'Date UTC', 'Collecté UTC', 'Dépenses', 'Impressions', 'Clics', 'Portée instantanée', 'Date de portée UTC', 'Coût par clic', 'Coût pour 1000 impressions', 'Taux de clic %', 'Fréquence instantanée', 'Coût par personne instantané', 'Actions (non agrégées)', 'Champs supplémentaires (non agrégés)', 'Chemins masqués'];
  const rows: unknown[][] = [locale === 'fr' ? fr : en];
  for (const item of items) {
    const base = (parentId: string | null) => [start, end, item.accountName, item.accountId, item.currency, item.level, item.name, item.objectId, parentId, item.coveredDays, item.requestedDays];
    rows.push(['summary', ...base(item.parentConsistent ? item.parentId : null), null, item.lastFetchedAt, item.spend, item.impressions, item.clicks, item.reach, item.reachDate, item.cpc, item.cpm, item.ctr, item.frequency, item.cpp, null, null, null]);
    for (const row of item.daily) rows.push(['daily', ...base(row.parentId), row.date, row.fetchedAt, row.spend, row.impressions, row.clicks, row.reach, row.date, row.cpc, row.cpm, row.ctr, row.frequency, row.cpp, row.actions, row.fields, row.redactedPaths]);
  }
  return rows.map(row => row.map(cell).join(',')).join('\r\n');
}
