import type { ReactNode } from 'react';
import { Badge } from '@/components/Badge';

export function Status({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'good' | 'warning' | 'neutral' }) {
  return <Badge tone={tone === "good" ? "success" : tone}>{children}</Badge>;
}
