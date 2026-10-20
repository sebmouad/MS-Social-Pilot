'use client';
import type { ReactNode } from 'react';
import { IconSearchOff } from '@tabler/icons-react';
import { EmptyState } from '@/components/EmptyState';
import { useRootInterface } from './RootInterface';

export function RootEmptyState({ title, children, route }: { title: string; children: ReactNode; route: string }) {
  const copy = useRootInterface();
  return <EmptyState title={title} icon={<IconSearchOff />} action={<a href={route}>{copy.reset}</a>}>{children}</EmptyState>;
}
