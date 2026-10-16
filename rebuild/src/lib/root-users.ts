export const ROOT_USER_STATUS_OPTIONS = [
  { value: 'all', label: 'All accounts' },
  { value: 'active', label: 'Active accounts' },
  { value: 'disabled', label: 'Disabled accounts' },
  { value: 'owners', label: 'Installation owners' },
] as const;
export type RootUsersStatus = typeof ROOT_USER_STATUS_OPTIONS[number]['value'];
export type RootUsersSearch = { q?: string | string[]; status?: string | string[]; page?: string | string[] };

export function rootUsersUrl(input: { q?: string; status?: RootUsersStatus; page?: number }) {
  const query = new URLSearchParams();
  if (input.q) query.set('q', input.q);
  if (input.status && input.status !== 'all') query.set('status', input.status);
  if (input.page && input.page > 1) query.set('page', String(input.page));
  return `/root/users${query.size ? `?${query}` : ''}`;
}
