/**
 * Recipe-source times formatted on the server in the source's own time zone. Browsers can carry different
 * time-zone data than Node (Chromium formats Africa/Casablanca one hour behind), so the screen shows these
 * labels and never formats a zoned instant itself.
 */
export type RecipeLabels = { lastRun: string | null; poolAsOf: string | null; slots: Record<string, string>;
  /** Each planned time's day and hour apart (2026-11-17), so the list can be read day by day. */
  days: Record<string, string>; times: Record<string, string> };

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
  const part = (options: Intl.DateTimeFormatOptions) => Object.fromEntries((view.plans?.items ?? []).flatMap(plan => {
    if (!zone || !Number.isFinite(Date.parse(plan.slotAt))) return [];
    try { return [[plan.id, new Intl.DateTimeFormat(locale, { ...options, timeZone: zone }).format(new Date(plan.slotAt))]]; } catch { return []; }
  }));
  return {
    days: part({ weekday: 'long', day: 'numeric', month: 'long' }), times: part({ hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }),
    lastRun: format(view.source?.lastRunAt),
    poolAsOf: format(view.pool?.asOf),
    slots: Object.fromEntries((view.plans?.items ?? []).flatMap(plan => { const label = format(plan.slotAt); return label ? [[plan.id, label]] : []; })),
  };
}

export const withRecipeLabels = <T extends LabelInput>(view: T, locale: 'en' | 'fr'): T & { labels: RecipeLabels } => ({ ...view, labels: recipeLabels(view, locale) });
