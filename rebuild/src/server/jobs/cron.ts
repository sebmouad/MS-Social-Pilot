/** Five-field cron matching in the server's local timezone. Supports lists, ranges, wildcards and steps. */
type Field = { values: Set<number>; wildcard: boolean };

function parseField(source: string, min: number, max: number, weekday = false): Field {
  if (!source) throw new Error('Cron fields cannot be empty.');
  const values = new Set<number>();
  let wildcard = false;
  for (const part of source.split(',')) {
    if (!part) throw new Error('Cron list contains an empty item.');
    const [base, stepText, extra] = part.split('/');
    if (extra !== undefined || !base) throw new Error('Invalid cron step.');
    const step = stepText === undefined ? 1 : Number(stepText);
    if (!Number.isInteger(step) || step < 1) throw new Error('Cron step must be a positive integer.');
    if (base === '*' && stepText === undefined) wildcard = true;
    let start: number;
    let end: number;
    if (base === '*') { start = min; end = max; }
    else if (base.includes('-')) {
      const range = base.split('-');
      if (range.length !== 2) throw new Error('Invalid cron range.');
      start = Number(range[0]); end = Number(range[1]);
    } else {
      start = Number(base); end = stepText === undefined ? start : max;
    }
    const fieldMax = weekday ? 7 : max;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < min || start > fieldMax || end < min || end > fieldMax || start > end) {
      throw new Error('Cron value is outside the supported range.');
    }
    for (let value = start; value <= fieldMax; value += step) values.add(weekday && value === 7 ? 0 : value);
  }
  return { values, wildcard };
}

export function cronMatches(expression: string, date: Date): boolean {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5 || !Number.isFinite(date.getTime())) throw new Error('Expected a five-field cron expression and valid date.');
  const fields = [
    parseField(parts[0]!, 0, 59), parseField(parts[1]!, 0, 23), parseField(parts[2]!, 1, 31),
    parseField(parts[3]!, 1, 12), parseField(parts[4]!, 0, 6, true),
  ];
  const [minute, hour, day, month, weekday] = fields as [Field, Field, Field, Field, Field];
  const dom = day.values.has(date.getDate());
  const dow = weekday.values.has(date.getDay());
  // Cron's day-of-month/day-of-week rule is OR when both are constrained.
  const dayMatches = day.wildcard || weekday.wildcard ? dom && dow : dom || dow;
  return minute.values.has(date.getMinutes()) && hour.values.has(date.getHours()) && month.values.has(date.getMonth() + 1) && dayMatches;
}
