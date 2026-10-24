import type { ReactNode } from 'react';
import { PageFrame } from '@/server/PageFrame';

/** Create is a full-screen sheet; the shell stays mounted behind it so a close returns to the page you came from. */
export default async function CreateLayout({ children }: { children: ReactNode }) {
  return <PageFrame module="publishing" scopedAccess>{children}</PageFrame>;
}
