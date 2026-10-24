'use client';
import type { ReactNode } from 'react';
import { useObjectRowOverlay } from './row-state';

/** Name cell of an object row; follows a confirmed rename or status change without a page reload. */
export function ObjectRowLabel({ adAccountId, level, objectId, name, status, children }: { adAccountId: string; level: string; objectId: string; name: string; status?: string | null; children?: ReactNode }) {
  const overlay = useObjectRowOverlay(adAccountId, level, objectId);
  const shownStatus = overlay?.status ?? status ?? null;
  return <>
    <strong>{overlay?.name ?? name}</strong>
    {shownStatus ? <> <span className="ui-badge" data-ads-row-status>{shownStatus}</span></> : null}
    <br />{children}
  </>;
}
