import { OperationError } from '@/lib/operation-error';
export type CollaborationView = 'assign' | 'fields' | 'queue' | 'mix';
/** Malformed or unavailable filters must never become a broader default read. */
export function parseCollaborationSearch(input: Record<string, unknown>, available: readonly CollaborationView[], maxCharacters: number) {
  const bad = () => new OperationError('invalid_request', 'Check the organization view, search and result page.');
  if (!Number.isSafeInteger(maxCharacters) || maxCharacters < 1) throw new OperationError('unavailable', 'Search is temporarily unavailable.');
  if (Object.entries(input).some(([key, value]) => !['view', 'page', 'q'].includes(key) || typeof value !== 'string')) throw bad();
  const view = input.view === undefined ? 'assign' : input.view;
  if (!available.includes(view as CollaborationView)) throw bad();
  const rawPage = input.page === undefined ? '1' : input.page;
  if (typeof rawPage !== 'string' || !/^[1-9]\d{0,5}$/.test(rawPage) || Number(rawPage) > 100000) throw bad();
  const q = typeof input.q === 'string' ? input.q.trim() : '';
  if (q.length > maxCharacters || /[\u0000-\u001f\u007f]/.test(q)) throw bad();
  return { view: view as CollaborationView, page: Number(rawPage), q };
}

export function parsePostCollaborationSearch(input: Record<string, unknown>) {
  if (Object.entries(input).some(([key, value]) => !['notesPage', 'versionsPage'].includes(key) || typeof value !== 'string')) throw new OperationError('invalid_request', 'Choose a valid notes or history page.');
  const page = (key: string) => { const value = input[key] ?? '1'; if (typeof value !== 'string' || !/^[1-9]\d{0,5}$/.test(value) || Number(value) > 100000) throw new OperationError('invalid_request', 'Choose a valid notes or history page.'); return Number(value); };
  return { notesPage: page('notesPage'), versionsPage: page('versionsPage') };
}
