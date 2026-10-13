import { prisma } from './prisma';

/**
 * Uptime history for the root status page. The web server
 * calls `recordUptimeMinute` once a minute: one minute for itself, and one for
 * the worker when its heartbeat is fresh. A day's uptime is the minutes seen
 * over the minutes that day has had since recording began. Database only.
 */

export const UPTIME_COMPONENTS = ['app', 'worker'] as const;
export type UptimeComponent = (typeof UPTIME_COMPONENTS)[number];
export const UPTIME_DAYS = 90;

/** Same freshness as the health check: four missed half-minute beats. */
const WORKER_FRESH_MS = 2 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const dayOf = (time: number) => new Date(time).toISOString().slice(0, 10);

async function addMinute(day: string, component: UptimeComponent): Promise<void> {
  await prisma.$executeRaw`
    INSERT INTO uptime_days (day, component, minutes) VALUES (${day}, ${component}, 1)
    ON CONFLICT (day, component) DO UPDATE SET minutes = LEAST(uptime_days.minutes + 1, 1440)
  `;
}

export async function recordUptimeMinute(now = Date.now()): Promise<void> {
  const day = dayOf(now);
  await addMinute(day, 'app');
  const newest = await prisma.workerHeartbeat.findFirst({ orderBy: { seenAt: 'desc' }, select: { seenAt: true } });
  if (newest && now - newest.seenAt.getTime() < WORKER_FRESH_MS) await addMinute(day, 'worker');
}

export interface UptimeHistory {
  /** Oldest first; a share is null on days before recording began. */
  days: Array<{ day: string; app: number | null; worker: number | null }>;
  /** Over the days with data, or null when there are none. */
  overall: Record<UptimeComponent, number | null>;
}

export async function loadUptime(now = Date.now()): Promise<UptimeHistory> {
  const first = dayOf(now - (UPTIME_DAYS - 1) * DAY_MS);
  const rows = await prisma.uptimeDay.findMany({ where: { day: { gte: first } } });
  const earliest = await prisma.uptimeDay.findFirst({ orderBy: { day: 'asc' }, select: { day: true } });
  const minutes = new Map(rows.map((row) => [`${row.day}:${row.component}`, row.minutes]));
  const today = dayOf(now);
  const minutesToday = Math.max(1, Math.floor((now - Date.parse(`${today}T00:00:00Z`)) / 60_000));

  const totals = { app: [0, 0], worker: [0, 0] } as Record<UptimeComponent, [number, number]>;
  const days: UptimeHistory['days'] = [];
  for (let index = UPTIME_DAYS - 1; index >= 0; index--) {
    const day = dayOf(now - index * DAY_MS);
    const recorded = earliest !== null && day >= earliest.day;
    // The first day counts from the first minute recorded, not from midnight.
    const possible = day === today ? minutesToday : 1440;
    const share = (component: UptimeComponent) => {
      if (!recorded) return null;
      const seen = minutes.get(`${day}:${component}`) ?? 0;
      const base = day === earliest!.day ? Math.max(seen, minutes.get(`${day}:app`) ?? 0, 1) : possible;
      totals[component][0] += seen;
      totals[component][1] += base;
      return Math.min(1, seen / base);
    };
    days.push({ day, app: share('app'), worker: share('worker') });
  }
  const overall = (component: UptimeComponent) => (totals[component][1] > 0 ? totals[component][0] / totals[component][1] : null);
  return { days, overall: { app: overall('app'), worker: overall('worker') } };
}
