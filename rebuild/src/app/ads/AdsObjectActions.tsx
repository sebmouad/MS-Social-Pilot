'use client';

import { ObjectManager } from './objects/ObjectManager';

type Props = { adAccountId: string; objectId: string; objectType: 'campaign' | 'adset' | 'ad'; name?: string; currency?: string | null; canRead: boolean; canManage: boolean };

/** Thin entry point: details and every change flow live in ObjectManager, which uses the neutral preview/apply service. */
export function AdsObjectActions({ adAccountId, objectId, objectType, name, canRead, canManage }: Props) {
  if (!canRead && !canManage) return null;
  return <ObjectManager adAccountId={adAccountId} level={objectType} objectId={objectId} name={name || objectId} />;
}
