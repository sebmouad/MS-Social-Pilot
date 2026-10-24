export function budgetFractionDigits(currency: string | null) {
  if (!currency) return 2;
  try { return new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2; }
  catch { return 2; }
}

export function parseBudgetAmount(value: string, currency: string | null): number | null {
  const clean = value.trim();
  if (!/^\d+(?:\.\d+)?$/.test(clean)) return null;
  const digits = budgetFractionDigits(currency);
  const [whole, fractional = ''] = clean.split('.');
  if (fractional.length > digits) return null;
  try {
    const scale = 10 ** digits;
    const amount = Number(whole) * scale + Number(fractional.padEnd(digits, '0') || '0');
    if (!Number.isSafeInteger(amount) || amount < 1) return null;
    return amount;
  } catch { return null; }
}

export function formatBudgetMinor(minor: number, currency: string | null): string {
  const digits = budgetFractionDigits(currency);
  const amount = minor / 10 ** digits;
  if (currency) {
    try { return new Intl.NumberFormat(undefined, { style: 'currency', currency, currencyDisplay: 'code', minimumFractionDigits: digits, maximumFractionDigits: digits }).format(amount); }
    catch { /* Fall through to a plain amount when a legacy currency code is invalid. */ }
  }
  return new Intl.NumberFormat(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(amount);
}
