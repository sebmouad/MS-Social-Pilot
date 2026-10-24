import { useSyncExternalStore } from 'react';

/** Client-side overlay for one directory row: values confirmed by a successful change, shown before the server re-renders. */
export type ObjectRowOverlay = { name?: string; status?: string };

const overlays = new Map<string, ObjectRowOverlay>();
const listeners = new Set<() => void>();
const rowKey = (adAccountId: string, level: string, objectId: string) => `${adAccountId}:${level}:${objectId}`;

export function patchObjectRow(adAccountId: string, level: string, objectId: string, patch: ObjectRowOverlay) {
  const key = rowKey(adAccountId, level, objectId);
  overlays.set(key, { ...overlays.get(key), ...patch });
  listeners.forEach(listener => listener());
}

export function useObjectRowOverlay(adAccountId: string, level: string, objectId: string): ObjectRowOverlay | undefined {
  const key = rowKey(adAccountId, level, objectId);
  return useSyncExternalStore(
    listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    () => overlays.get(key),
    () => undefined,
  );
}
