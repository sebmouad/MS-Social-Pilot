import type { Digest, GroupRow, PostSummary, Totals } from './performance';
import local from './screen.module.css';

/**
 * "What works": every breakdown the content-performance digest gives an agent, shown to the member as well, with the
 * change against the previous period of the same length. Missing figures stay "—", never zero.
 */
type Locale = 'en' | 'fr';
const COPY = {
  en: {
    title: 'What works', intro: 'Typical reach (median people reached per post) and engagement per 100 people reached, from stored measures. Groups with fewer than 5 posts are marked as too few to trust.',
    posts: 'Posts', median: 'Typical reach', per100: 'Engagement per 100 reached', total: 'People reached (sum)', vsBefore: 'vs previous period', none: 'Not enough measured posts in this period.',
    hour: 'Posting hour', weekday: 'Weekday', channel: 'Channel', profile: 'Connected profile', origin: 'Origin', opening: 'Caption opening', question: 'Question in caption', length: 'Caption length',
    best: 'Best posts', weakest: 'Weakest posts', few: 'too few', open: 'Open', madeHere: 'made in this app', elsewhere: 'published elsewhere', incomplete: 'Only the first posts of this period were read (report row limit); narrow the period or channels for a complete view.',
  },
  fr: {
    title: 'Ce qui marche', intro: 'Portée typique (médiane des personnes touchées par publication) et interactions pour 100 personnes touchées, d’après les mesures enregistrées. Les groupes de moins de 5 publications sont signalés comme trop petits.',
    posts: 'Publications', median: 'Portée typique', per100: 'Interactions pour 100 touchées', total: 'Personnes touchées (somme)', vsBefore: 'vs période précédente', none: 'Pas assez de publications mesurées sur cette période.',
    hour: 'Heure de publication', weekday: 'Jour', channel: 'Canal', profile: 'Profil connecté', origin: 'Origine', opening: 'Début de la légende', question: 'Question dans la légende', length: 'Longueur de la légende',
    best: 'Meilleures publications', weakest: 'Publications les plus faibles', few: 'trop peu', open: 'Ouvrir', madeHere: 'créée dans l’application', elsewhere: 'publiée ailleurs', incomplete: 'Seules les premières publications de la période ont été lues (limite de lignes) ; réduisez la période ou les canaux pour une vue complète.',
  },
} as const;
const GROUPS = ['hour', 'weekday', 'channel', 'profile', 'origin', 'opening', 'question', 'length'] as const;

const num = (value: number | null, locale: Locale) => value === null ? '—' : new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value);
function change(now: number | null, before: number | null | undefined) {
  if (now === null || before === null || before === undefined || before === 0) return null;
  const pct = Math.round(((now - before) / before) * 100);
  return `${pct > 0 ? '+' : ''}${pct}%`;
}

export function PerformancePanel({ digest, before, complete, locale }: { digest: Digest; before: Totals | null; complete: boolean; locale: Locale }) {
  const t = COPY[locale];
  if (!digest.totals.measured) return <section aria-labelledby="what-works"><h2 id="what-works">{t.title}</h2><p>{t.none}</p></section>;
  const tile = (label: string, value: number | null, previous: number | null | undefined) => {
    const delta = change(value, previous);
    return <div className="ui-card-interactive" style={{ padding: 12, borderRadius: 8 }}><div className="small-note">{label}</div><strong style={{ fontSize: 22 }}>{num(value, locale)}</strong>{delta && <div className="small-note">{delta} {t.vsBefore}</div>}</div>;
  };
  const table = (key: (typeof GROUPS)[number], rows: GroupRow[]) => <div key={key}>
    <h3>{t[key]}</h3>
    <div className="ui-table-wrap"><table className="ui-table ui-table--compact ui-table--zebra">
      <thead><tr><th scope="col">{t[key]}</th><th scope="col">{t.posts}</th><th scope="col">{t.median}</th><th scope="col">{t.per100}</th></tr></thead>
      <tbody>{rows.map(row => <tr key={row.key}><th scope="row">{key === 'origin' ? (row.key === 'made in this app' ? t.madeHere : t.elsewhere) : row.key}{row.lowSample && <> <span className="ui-badge ui-badge--warning">{t.few}</span></>}</th><td>{row.posts}</td><td>{num(row.medianReach, locale)}</td><td>{num(row.engagementPer100, locale)}</td></tr>)}</tbody>
    </table></div>
  </div>;
  const posts = (title: string, items: PostSummary[]) => <div>
    <h3>{title}</h3>
    <div className="ui-table-wrap"><table className="ui-table ui-table--compact">
      <thead><tr><th scope="col">{t.median}</th><th scope="col">{t.per100}</th><th scope="col">{t.channel}</th><th scope="col">{t.posts}</th></tr></thead>
      <tbody>{items.map(item => <tr key={item.postId}><td>{num(item.reach, locale)}</td><td>{item.reach ? num(Math.round(10000 * (item.engagement ?? 0) / item.reach) / 100, locale) : '—'}</td><td>{item.channel}<div className="small-note">{new Date(item.publishedAt).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' })} · {item.madeHere ? t.madeHere : t.elsewhere}</div></td><td>{item.text.slice(0, 140) || '—'}{item.url && <> <a href={item.url} target="_blank" rel="noopener noreferrer">{t.open}</a></>}</td></tr>)}</tbody>
    </table></div>
  </div>;
  return <section aria-labelledby="what-works" className={local.content}>
    <h2 id="what-works">{t.title}</h2>
    <p className="small-note">{t.intro}</p>
    {!complete && <p className="small-note" role="status">{t.incomplete}</p>}
    <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
      {tile(t.posts, digest.totals.posts, before?.posts)}
      {tile(t.median, digest.totals.medianReach, before?.medianReach)}
      {tile(t.per100, digest.totals.engagementPer100, before?.engagementPer100)}
      {tile(t.total, digest.totals.totalReach, before?.totalReach)}
    </div>
    <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))' }}>
      {GROUPS.map(key => table(key, digest.groups[key]))}
    </div>
    {posts(t.best, digest.best)}
    {posts(t.weakest, digest.weakest)}
  </section>;
}
