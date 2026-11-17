'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { Tabs } from '@/components/Tabs';

/** Today and tomorrow share one place on the cockpit (2026-11-17); a link to `#tomorrow` or `#today` opens that day. */
export function AutopilotDays({ label, initial, days }: { label: string; initial: string; days: Array<{ id: string; label: string; count: number; content: ReactNode }> }) {
  const [day, setDay] = useState(initial);
  useEffect(() => {
    const follow = () => { const id = window.location.hash.slice(1); if (days.some(item => item.id === id)) { setDay(id); document.getElementById('plan')?.scrollIntoView(); } };
    follow();
    window.addEventListener('hashchange', follow);
    return () => window.removeEventListener('hashchange', follow);
    // The day list is fixed for the page's life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <Tabs label={label} value={day} onChange={setDay} items={days} />;
}
