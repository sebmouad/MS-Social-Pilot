/** Default chart copy. Callers may override the visible strings through props. */
export type ChartMessages = {
  loading: string;
  emptyTitle: string;
  emptyHint: string;
  errorTitle: string;
  date: string;
  category: string;
  total: string;
  value: string;
  share: string;
  stage: string;
  ofPrevious: string;
  ofFirst: string;
  day: string;
  previousPeriod: string;
};

const en: ChartMessages = {
  loading: "Loading chart…",
  emptyTitle: "No data to chart yet",
  emptyHint: "Numbers appear here once data is available for this selection.",
  errorTitle: "This chart could not be loaded",
  date: "Date",
  category: "Category",
  total: "Total",
  value: "Value",
  share: "Share",
  stage: "Stage",
  ofPrevious: "% of previous stage",
  ofFirst: "% of first stage",
  day: "Day",
  previousPeriod: "previous period",
};

const fr: ChartMessages = {
  loading: "Chargement du graphique…",
  emptyTitle: "Aucune donnée à afficher",
  emptyHint: "Les chiffres apparaissent ici dès que des données sont disponibles pour cette sélection.",
  errorTitle: "Ce graphique n’a pas pu être chargé",
  date: "Date",
  category: "Catégorie",
  total: "Total",
  value: "Valeur",
  share: "Part",
  stage: "Étape",
  ofPrevious: "% de l’étape précédente",
  ofFirst: "% de la première étape",
  day: "Jour",
  previousPeriod: "période précédente",
};

export function getMessages(locale: string): ChartMessages {
  return locale.toLowerCase().startsWith("fr") ? fr : en;
}
