/**
 * Recipe-source times formatted on the server in the source's own time zone. Browsers can carry different
 * time-zone data than Node (Chromium formats Africa/Casablanca one hour behind), so the screen shows these
 * labels and never formats a zoned instant itself.
 */
export type RecipeLabels = { lastRun: string | null; poolAsOf: string | null; slots: Record<string, string> };

type LabelInput = {
  source?: { lastRunAt?: string | null; config?: { timezone: string } } | null;
  plans?: { items: Array<{ id: string; slotAt: string }> } | null;
  pool?: { asOf: string } | null;
};

export function recipeLabels(view: LabelInput, locale: 'en' | 'fr'): RecipeLabels {
  const zone = view.source?.config?.timezone;
  const format = (value: string | null | undefined) => {
    if (!zone || !value || !Number.isFinite(Date.parse(value))) return null;
    try { return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: zone }).format(new Date(value)); } catch { return null; }
  };
  return {
    lastRun: format(view.source?.lastRunAt),
    poolAsOf: format(view.pool?.asOf),
    slots: Object.fromEntries((view.plans?.items ?? []).flatMap(plan => { const label = format(plan.slotAt); return label ? [[plan.id, label]] : []; })),
  };
}

export const withRecipeLabels = <T extends LabelInput>(view: T, locale: 'en' | 'fr'): T & { labels: RecipeLabels } => ({ ...view, labels: recipeLabels(view, locale) });
