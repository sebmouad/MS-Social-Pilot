import type { ReactNode } from 'react';
import { PageFrame } from '@/server/PageFrame';
import { AGENCY_MODULE_ID } from '@/modules/agency/agency';

/** Agency is a product module of its own: the shared shell supplies the module rail and the contextual sidebar, which the manifest pages and filters dock into. */
export default function AgencyLayout({ children }: { children: ReactNode }) {
  return <PageFrame module={AGENCY_MODULE_ID} scopedAccess>{children}</PageFrame>;
}
