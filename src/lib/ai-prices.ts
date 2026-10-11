/**
 * What AI models cost, in US dollars per million tokens.
 *
 * No provider serves its prices through its API, so this table is the one
 * place prices are typed in, copied from each provider's pricing page on
 * `PRICES_CHECKED`. It is not a model list: which models exist still comes
 * from the provider (src/lib/ai-models.ts). A model missing here is shown as
 * "price unknown", never as $0, and root can add or correct any price in
 * Configuration (`ai.priceOverrides`) without waiting for a release.
 *
 * Only the standard prices for short prompts are listed. Some models charge
 * more past 100,000 or 200,000 prompt tokens; the app's prompts are a few
 * thousand tokens at most, so those tiers never apply here.
 *
 * Plain module, no server imports: the Configuration screen formats these too.
 */
export const PRICES_CHECKED = '2026-10-11';

export const PRICE_SOURCES = {
  anthropic: 'https://platform.claude.com/docs/en/about-claude/pricing',
  openai: 'https://developers.openai.com/api/docs/pricing',
  gemini: 'https://ai.google.dev/gemini-api/docs/pricing',
} as const;

export interface ModelPrice {
  /** USD per million input tokens. */
  input: number;
  /** USD per million output tokens. */
  output: number;
}

/** A price that changes on a known date: the later entry applies from `from` (UTC day). */
interface DatedPrice extends ModelPrice {
  from?: string;
}

const PRICES: Record<string, DatedPrice[]> = {
  // Anthropic
  'claude-fable-5-1': [{ input: 10, output: 50 }],
  'claude-fable-5': [{ input: 10, output: 50 }],
  'claude-mythos-5-1': [{ input: 10, output: 50 }],
  'claude-mythos-5': [{ input: 10, output: 50 }],
  'claude-opus-5-5': [{ input: 4, output: 20 }],
  'claude-opus-5': [{ input: 5, output: 25 }],
  'claude-opus-4-8': [{ input: 5, output: 25 }],
  'claude-opus-4-7': [{ input: 5, output: 25 }],
  'claude-opus-4-6': [{ input: 5, output: 25 }],
  'claude-opus-4-5': [{ input: 5, output: 25 }],
  'claude-opus-4-1': [{ input: 15, output: 75 }],
  'claude-opus-4': [{ input: 15, output: 75 }],
  'claude-sonnet-5-5': [{ input: 2, output: 10 }],
  'claude-sonnet-5': [{ input: 2, output: 10 }],
  'claude-sonnet-4-6': [{ input: 3, output: 15 }],
  'claude-sonnet-4-5': [{ input: 3, output: 15 }],
  'claude-sonnet-4': [{ input: 3, output: 15 }],
  'claude-haiku-5-5': [{ input: 0.1, output: 0.5 }],
  'claude-haiku-4-5': [{ input: 1, output: 5 }],
  'claude-3-5-haiku': [{ input: 0.8, output: 4 }],
  // OpenAI
  'gpt-6-astra': [{ input: 10, output: 50 }],
  'gpt-6.1-sol': [{ input: 2, output: 10 }],
  'gpt-6-sol': [{ input: 2, output: 10 }],
  'gpt-6-luna': [{ input: 0.1, output: 0.5 }],
  'gpt-5.6-sol': [{ input: 4, output: 20 }],
  'gpt-5.6-terra': [{ input: 2, output: 12 }],
  'gpt-5.6-luna': [{ input: 0.2, output: 1.2 }],
  'gpt-5.5': [{ input: 5, output: 30 }],
  'gpt-5.5-pro': [{ input: 30, output: 180 }],
  'gpt-5.4': [{ input: 2.5, output: 15 }],
  'gpt-5.4-mini': [{ input: 0.75, output: 4.5 }],
  'gpt-5.4-nano': [{ input: 0.2, output: 1.25 }],
  'gpt-5.4-pro': [{ input: 30, output: 180 }],
  'gpt-5.2': [{ input: 1.75, output: 14 }],
  'gpt-5.2-pro': [{ input: 21, output: 168 }],
  'gpt-5.1': [{ input: 1.25, output: 10 }],
  'gpt-5': [{ input: 1.25, output: 10 }],
  'gpt-5-mini': [{ input: 0.25, output: 2 }],
  'gpt-5-nano': [{ input: 0.05, output: 0.4 }],
  'gpt-5-pro': [{ input: 15, output: 120 }],
  'gpt-4.1': [{ input: 2, output: 8 }],
  'gpt-4.1-mini': [{ input: 0.4, output: 1.6 }],
  'gpt-4.1-nano': [{ input: 0.1, output: 0.4 }],
  'gpt-4o': [{ input: 2.5, output: 10 }],
  'gpt-4o-2024-05-13': [{ input: 5, output: 15 }],
  'gpt-4o-mini': [{ input: 0.15, output: 0.6 }],
  o1: [{ input: 15, output: 60 }],
  'o1-pro': [{ input: 150, output: 600 }],
  o3: [{ input: 2, output: 8 }],
  'o3-pro': [{ input: 20, output: 80 }],
  'o3-mini': [{ input: 1.1, output: 4.4 }],
  'o4-mini': [{ input: 1.1, output: 4.4 }],
  'gpt-4-turbo': [{ input: 10, output: 30 }],
  'gpt-4': [{ input: 30, output: 60 }],
  'gpt-4-0613': [{ input: 30, output: 60 }],
  'gpt-3.5-turbo': [{ input: 0.5, output: 1.5 }],
  // Google Gemini (paid tier). Google lists higher prices for some models from 2027.
  'gemini-3.8-flash': [{ input: 0.75, output: 3.75 }, { from: '2027-01-01', input: 1.5, output: 7.5 }],
  'gemini-3.6-flash': [{ input: 0.75, output: 3.75 }, { from: '2027-01-01', input: 1.5, output: 7.5 }],
  'gemini-3.5-flash-lite': [{ input: 0.3, output: 2.5 }],
  'gemini-3.1-flash-lite': [{ input: 0.25, output: 1.5 }],
  'gemini-3.1-pro-preview': [{ input: 2, output: 12 }],
  'gemini-3-flash-preview': [{ input: 0.5, output: 3 }],
  'gemini-2.5-pro': [{ input: 1.25, output: 10 }],
  'gemini-2.5-flash': [{ input: 0.3, output: 2.5 }],
  'gemini-2.5-flash-lite': [{ input: 0.1, output: 0.4 }],
};

/** One override as typed in Configuration: `model-id=input/output`. */
export const PRICE_OVERRIDE_PATTERN = /^[A-Za-z0-9._:-]+=\d+(\.\d+)?\/\d+(\.\d+)?$/;

function parseOverrides(overrides: string[]): Map<string, ModelPrice> {
  const prices = new Map<string, ModelPrice>();
  for (const entry of overrides) {
    if (!PRICE_OVERRIDE_PATTERN.test(entry.trim())) continue;
    const [id, money] = entry.trim().split('=');
    const [input, output] = money!.split('/').map(Number);
    prices.set(id!, { input: input!, output: output! });
  }
  return prices;
}

/**
 * The ids to look up for a model, most specific first: as listed, then
 * without a dated snapshot suffix (`-20250514`, `-2024-08-06`), then without a
 * `-0` / `-latest` alias suffix. Never a shorter family name, so a new
 * `claude-opus-5-7` is "price unknown" rather than priced as `claude-opus-5`.
 */
function candidates(model: string): string[] {
  const ids = [model];
  const undated = model.replace(/-(\d{8}|\d{4}-\d{2}-\d{2})$/, '');
  if (undated !== model) ids.push(undated);
  const unaliased = undated.replace(/-(0|latest)$/, '');
  if (unaliased !== undated) ids.push(unaliased);
  return ids;
}

/** The model's price, or null when nobody has said what it costs. An override wins. */
export function priceFor(model: string, overrides: string[] = [], now: Date = new Date()): ModelPrice | null {
  const custom = parseOverrides(overrides);
  for (const id of candidates(model)) {
    const override = custom.get(id);
    if (override) return override;
    const dated = PRICES[id];
    if (dated) {
      const day = now.toISOString().slice(0, 10);
      const current = dated.filter((price) => !price.from || price.from <= day).at(-1)!;
      return { input: current.input, output: current.output };
    }
  }
  return null;
}

/** US dollars for one call. */
export function costUsd(price: ModelPrice, inputTokens: number, outputTokens: number): number {
  return (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
}

/** AI spend for root's Configuration screen; built in src/lib/ai.ts. */
export interface AiSpendView {
  monthUsd: number;
  last30Usd: number;
  /** 0 = no budget. */
  budgetUsd: number;
  /** Last 30 days, by provider and model, most expensive first. */
  byModel: Array<{
    provider: string | null;
    model: string;
    generations: number;
    /** Generations with no known price, which `costUsd` leaves out. */
    unpriced: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
  }>;
  /** Last 30 days, by workspace, most expensive first. */
  byWorkspace: Array<{ workspaceId: string; name: string; generations: number; unpriced: number; costUsd: number }>;
}
