/** Preserve repeated query values so the domain service can reject ambiguous scalars. */
export function analyticsQuery(params: URLSearchParams): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  for (const key of new Set(params.keys())) {
    const values = params.getAll(key);
    input[key] = values.length > 1 ? values : values[0];
  }
  return input;
}
