export type NumberFormat = {
  style?: "number" | "percent" | "currency" | "unit";
  /** ISO 4217 code, used by `currency`. */
  currency?: string;
  /** Intl unit identifier (for example `second`), used by `unit`. */
  unit?: string;
  /** Percent values are ratios (0.25 = 25%), as Intl expects. */
  compact?: boolean;
  maximumFractionDigits?: number;
};

export type Granularity = "hour" | "day" | "week" | "month" | "year";
export type ChartTime = string | number | Date;

/** Missing data is unknown, never zero. */
export const UNKNOWN = "—";

function safeNumberFormat(locale: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  try { return new Intl.NumberFormat(locale, options); } catch { return new Intl.NumberFormat("en"); }
}

export function numberFormatter(locale: string, format: NumberFormat = {}): (value: number | null | undefined) => string {
  const style = format.style ?? "number";
  const options: Intl.NumberFormatOptions = { style: style === "number" ? "decimal" : style };
  if (style === "currency") options.currency = format.currency ?? "USD";
  if (style === "unit") { options.unit = format.unit ?? "second"; options.unitDisplay = "short"; }
  if (format.compact) options.notation = "compact";
  if (format.maximumFractionDigits !== undefined) options.maximumFractionDigits = format.maximumFractionDigits;
  else if (style === "percent") options.maximumFractionDigits = 1;
  const formatter = safeNumberFormat(locale, options);
  return value => typeof value === "number" && Number.isFinite(value) ? formatter.format(value) : UNKNOWN;
}

export function toTime(value: ChartTime): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

/** Axis labels are short; tooltips and the table use the full form. Defaults to UTC so server and client render the same text. */
export function dateFormatters(locale: string, granularity: Granularity = "day", timeZone = "UTC") {
  const axisOptions: Record<Granularity, Intl.DateTimeFormatOptions> = {
    hour: { month: "short", day: "numeric", hour: "numeric" },
    day: { month: "short", day: "numeric" },
    week: { month: "short", day: "numeric" },
    month: { month: "short", year: "2-digit" },
    year: { year: "numeric" },
  };
  const fullOptions: Record<Granularity, Intl.DateTimeFormatOptions> = {
    hour: { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" },
    day: { year: "numeric", month: "short", day: "numeric" },
    week: { year: "numeric", month: "short", day: "numeric" },
    month: { year: "numeric", month: "long" },
    year: { year: "numeric" },
  };
  const make = (options: Intl.DateTimeFormatOptions) => {
    let formatter: Intl.DateTimeFormat;
    try { formatter = new Intl.DateTimeFormat(locale, { ...options, timeZone }); } catch { formatter = new Intl.DateTimeFormat("en", { ...options, timeZone: "UTC" }); }
    return (time: number) => Number.isFinite(time) ? formatter.format(time) : UNKNOWN;
  };
  return { axis: make(axisOptions[granularity]), full: make(fullOptions[granularity]) };
}

/** First day of the week for the locale: 0 = Sunday … 6 = Saturday. */
export function defaultWeekStart(locale: string): number {
  try {
    const intlLocale = new Intl.Locale(locale) as unknown as { getWeekInfo?: () => { firstDay: number }; weekInfo?: { firstDay: number } };
    const first = (intlLocale.getWeekInfo?.() ?? intlLocale.weekInfo)?.firstDay;
    return first === undefined ? 0 : first % 7;
  } catch { return 0; }
}

/** Weekday names indexed 0 = Sunday … 6 = Saturday. */
export function weekdayNames(locale: string): string[] {
  const formatter = new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" });
  return Array.from({ length: 7 }, (_, day) => formatter.format(Date.UTC(2023, 0, 1 + day)));
}

export function hourLabels(locale: string): string[] {
  const formatter = new Intl.DateTimeFormat(locale, { hour: "numeric", timeZone: "UTC" });
  return Array.from({ length: 24 }, (_, hour) => formatter.format(Date.UTC(2000, 0, 1, hour)));
}

const HTML_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => HTML_ESCAPES[character]!);
}
