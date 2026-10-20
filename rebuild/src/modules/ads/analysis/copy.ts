import type { AdsFindingKey, AdsKpiKey } from './metrics';

/** Customer copy for the Ads comparison in both shipped languages; keys mirror legacy `ads.*`. */
export const adsCopy = {
  en: {
    eyebrow: 'Ads / Compare', title: 'Compare performance',
    rangeLine: '{from} to {to} (end excluded)', earlierLine: ' · earlier period {from} to {to}',
    emptyTitle: 'No ad data in this range',
    emptyHint: 'Choose another range or account. Figures appear after an advertising account has synced.',
    errorHint: 'Adjust your filters, or reset them, and try again.',
    noGroupData: 'No stored data in this range. These figures are unknown, not zero.',
    staleData: 'Data may be out of date. ', updatedAt: 'Last updated {when}.', updateUnknown: 'Update time unknown.',
    dayCount: ' {days} day(s) of account data.',
    syncedLine: '{account}: read from the provider {when}', neverSynced: '{account}: not read yet',
    coverageLine: 'Stored data covers {from} to {to}.',
    noAccountTotals: 'Account totals and daily trend are unavailable; object level rows are shown below.',
    'kpi.spend': 'Spend', 'kpi.impressions': 'Impressions', 'kpi.clicks': 'Clicks', 'kpi.ctr': 'Click-through rate', 'kpi.cpc': 'Cost per click', 'kpi.cpm': 'Cost per 1,000 views',
    unknown: 'Unknown', noChange: 'No change figure', noEarlier: 'No earlier data',
    vsEarlier: '{percent} vs earlier', better: ' (better)', worse: ' (worse)',
    findingsLabel: 'Findings',
    'finding.noSpend': 'This account spent nothing in this period. Sync it if you expected delivery.',
    'finding.cpcDown': 'Clicks cost {percent}% less than in the previous period.',
    'finding.cpcUp': 'Clicks cost {percent}% more than in the previous period.',
    'finding.ctrUp': 'People clicked {percent}% more often than in the previous period.',
    'finding.ctrDown': 'People clicked {percent}% less often than in the previous period.',
    'finding.concentrated': '“{name}” took {share}% of the spend.',
    'finding.bestCtr': '“{name}” is clicked {ratio}× as often as the account average.',
    'finding.costlyClicks': 'Clicks on “{name}” cost {ratio}× the account average.',
    dailyTrend: 'Daily spend and clicks', dailyCaption: 'Daily trend', day: 'Day',
    figuresCaption: '{level} figures', noObjects: 'No objects at this level in this range.',
    'col.name': 'Name', 'col.spend': 'Spend', 'col.share': 'Share of spend', 'col.impressions': 'Impressions', 'col.clicks': 'Clicks',
    'col.ctr': 'CTR', 'col.cpc': 'Cost per click', 'col.cpm': 'Cost per 1,000', 'col.reach': 'Reach (best day)',
    actionsTitle: 'Actions', actionsHint: 'Every action type produced, summed over the range.', metricDetails: 'All stored actions', periodActions: 'Actions over this period',
    showing: 'Showing the first {shown} of {total}.',
    exportPending: 'Preparing CSV…', exportError: 'Export could not be downloaded. Review your access, narrow the filters or try again.', exportSuccess: 'CSV download prepared.',
    exportFindings: 'Download findings CSV', exportCsv: 'Download CSV', exportHint: 'Objects with daily trends and previous-period changes; missing figures are Not available.',
    reachNote: 'Reach counts people, so it is shown as the highest single day rather than a sum. Different currencies are never combined.',
    'level.campaign': 'Campaigns', 'level.adset': 'Ad sets', 'level.ad': 'Ads',
    compareLabel: 'Compare', comparePrevious: 'With the previous period', compareAccounts: 'Across accounts',
    show: 'Show', sortBy: 'Sort by', order: 'Order', highest: 'Highest first', lowest: 'Lowest first', apply: 'Apply', optionsLabel: 'Comparison options',
    'col.count': 'Count',
  },
  fr: {
    eyebrow: 'Publicités / Comparer', title: 'Comparer les performances',
    rangeLine: 'Du {from} au {to} (fin exclue)', earlierLine: ' · période précédente du {from} au {to}',
    emptyTitle: 'Aucune donnée publicitaire sur cette période',
    emptyHint: 'Choisissez une autre période ou un autre compte. Les chiffres apparaissent après la synchronisation d’un compte publicitaire.',
    errorHint: 'Modifiez vos filtres, ou réinitialisez-les, puis réessayez.',
    noGroupData: 'Aucune donnée enregistrée sur cette période. Ces chiffres sont inconnus, pas à zéro.',
    staleData: 'Les données sont peut-être obsolètes. ', updatedAt: 'Dernière mise à jour : {when}.', updateUnknown: 'Date de mise à jour inconnue.',
    dayCount: ' {days} jour(s) de données de compte.',
    syncedLine: '{account} : lu auprès du fournisseur {when}', neverSynced: '{account} : pas encore lu',
    coverageLine: 'Les données enregistrées couvrent du {from} au {to}.',
    noAccountTotals: 'Les totaux du compte et la tendance quotidienne sont indisponibles ; les lignes par objet sont affichées ci-dessous.',
    'kpi.spend': 'Dépense', 'kpi.impressions': 'Impressions', 'kpi.clicks': 'Clics', 'kpi.ctr': 'Taux de clic', 'kpi.cpc': 'Coût par clic', 'kpi.cpm': 'Coût pour 1 000 vues',
    unknown: 'Inconnu', noChange: 'Pas de variation calculable', noEarlier: 'Pas de données antérieures',
    vsEarlier: '{percent} par rapport à avant', better: ' (mieux)', worse: ' (moins bien)',
    findingsLabel: 'Constats',
    'finding.noSpend': 'Ce compte n’a rien dépensé sur cette période. Synchronisez-le si vous attendiez une diffusion.',
    'finding.cpcDown': 'Les clics coûtent {percent} % de moins que sur la période précédente.',
    'finding.cpcUp': 'Les clics coûtent {percent} % de plus que sur la période précédente.',
    'finding.ctrUp': 'Les gens ont cliqué {percent} % plus souvent que sur la période précédente.',
    'finding.ctrDown': 'Les gens ont cliqué {percent} % moins souvent que sur la période précédente.',
    'finding.concentrated': '« {name} » a pris {share} % de la dépense.',
    'finding.bestCtr': '« {name} » est cliquée {ratio} × plus souvent que la moyenne du compte.',
    'finding.costlyClicks': 'Les clics sur « {name} » coûtent {ratio} × la moyenne du compte.',
    dailyTrend: 'Dépense et clics par jour', dailyCaption: 'Tendance quotidienne', day: 'Jour',
    figuresCaption: 'Chiffres : {level}', noObjects: 'Aucun objet à ce niveau sur cette période.',
    'col.name': 'Nom', 'col.spend': 'Dépense', 'col.share': 'Part de la dépense', 'col.impressions': 'Impressions', 'col.clicks': 'Clics',
    'col.ctr': 'Taux de clic', 'col.cpc': 'Coût par clic', 'col.cpm': 'Coût pour 1 000', 'col.reach': 'Portée (meilleur jour)',
    actionsTitle: 'Actions', actionsHint: 'Tous les types d’action produits, additionnés sur la période.', metricDetails: 'Toutes les actions enregistrées', periodActions: 'Actions sur cette période',
    showing: 'Affichage des {shown} premiers sur {total}.',
    exportPending: 'Préparation du CSV…', exportError: 'Le téléchargement a échoué. Vérifiez votre accès, réduisez les filtres ou réessayez.', exportSuccess: 'Téléchargement du CSV préparé.',
    exportFindings: 'Télécharger les constats en CSV', exportCsv: 'Télécharger le CSV', exportHint: 'Objets avec tendances quotidiennes et variations ; les chiffres manquants sont indiqués Not available.',
    reachNote: 'La portée compte des personnes : elle est affichée comme le meilleur jour et non comme une somme. Les devises différentes ne sont jamais additionnées.',
    'level.campaign': 'Campagnes', 'level.adset': 'Ensembles de publicités', 'level.ad': 'Publicités',
    compareLabel: 'Comparer', comparePrevious: 'Avec la période précédente', compareAccounts: 'Entre comptes',
    show: 'Afficher', sortBy: 'Trier par', order: 'Ordre', highest: 'Du plus élevé', lowest: 'Du plus faible', apply: 'Appliquer', optionsLabel: 'Options de comparaison',
    'col.count': 'Nombre',
  },
} as const;

export type AdsLocale = keyof typeof adsCopy;
export type AdsCopyKey = keyof typeof adsCopy.en;

/** `fr` for French-speaking browsers, otherwise English. */
export function adsLocale(acceptLanguage: string | null | undefined): AdsLocale {
  return /^\s*fr\b/i.test(acceptLanguage ?? '') ? 'fr' : 'en';
}

export function adsText(locale: AdsLocale, key: AdsCopyKey, values: Record<string, string | number> = {}): string {
  return (adsCopy[locale][key] as string).replace(/\{(\w+)\}/g, (whole, name: string) => name in values ? String(values[name]) : whole);
}

export const adsFindingText = (locale: AdsLocale, key: AdsFindingKey, params: Record<string, string | number>) =>
  adsText(locale, `finding.${key}` as AdsCopyKey, params);
export const adsKpiLabel = (locale: AdsLocale, key: AdsKpiKey) => adsText(locale, `kpi.${key}` as AdsCopyKey);
