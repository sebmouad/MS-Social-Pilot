/**
 * Days worth a post: international observances everybody shares, and the
 * public holidays of the two countries this app's users mostly work in.
 *
 * Fixed-date days only. Moveable feasts (Eid, Easter, Mother's Day) change
 * every year and a wrong date on a content calendar is worse than none, so
 * they are left out rather than guessed.
 */

export interface AwarenessDay {
  /** `MM-DD`. */
  date: string;
  /** Message key under `calendar.days`. */
  key: string;
  /** Where it is observed: everywhere, or one country. */
  scope: 'world' | 'fr' | 'ma';
}

export const AWARENESS_DAYS: AwarenessDay[] = [
  { date: '01-01', key: 'newYear', scope: 'world' },
  { date: '01-11', key: 'maIndependenceManifesto', scope: 'ma' },
  { date: '02-04', key: 'worldCancerDay', scope: 'world' },
  { date: '02-14', key: 'valentines', scope: 'world' },
  { date: '03-08', key: 'womensDay', scope: 'world' },
  { date: '03-20', key: 'happinessDay', scope: 'world' },
  { date: '04-07', key: 'worldHealthDay', scope: 'world' },
  { date: '04-22', key: 'earthDay', scope: 'world' },
  { date: '05-01', key: 'labourDay', scope: 'world' },
  { date: '05-08', key: 'frVictory', scope: 'fr' },
  { date: '06-05', key: 'environmentDay', scope: 'world' },
  { date: '06-21', key: 'musicDay', scope: 'fr' },
  { date: '07-14', key: 'frBastille', scope: 'fr' },
  { date: '07-30', key: 'maThroneDay', scope: 'ma' },
  { date: '08-14', key: 'maOuedEddahab', scope: 'ma' },
  { date: '08-15', key: 'assumption', scope: 'fr' },
  { date: '08-20', key: 'maRevolution', scope: 'ma' },
  { date: '08-21', key: 'maYouthDay', scope: 'ma' },
  { date: '09-21', key: 'peaceDay', scope: 'world' },
  { date: '09-27', key: 'tourismDay', scope: 'world' },
  { date: '09-29', key: 'heartDay', scope: 'world' },
  { date: '10-01', key: 'coffeeDay', scope: 'world' },
  { date: '10-10', key: 'mentalHealthDay', scope: 'world' },
  { date: '10-16', key: 'foodDay', scope: 'world' },
  { date: '10-31', key: 'halloween', scope: 'world' },
  { date: '11-01', key: 'allSaints', scope: 'fr' },
  { date: '11-06', key: 'maGreenMarch', scope: 'ma' },
  { date: '11-11', key: 'frArmistice', scope: 'fr' },
  { date: '11-18', key: 'maIndependence', scope: 'ma' },
  { date: '11-27', key: 'blackFriday', scope: 'world' },
  { date: '12-25', key: 'christmas', scope: 'world' },
  { date: '12-31', key: 'newYearsEve', scope: 'world' },
];

/** The days falling on `yyyy-MM-dd`. Black Friday is the Friday after the fourth Thursday of November. */
export function awarenessOn(day: string): AwarenessDay[] {
  const monthDay = day.slice(5);
  const year = Number(day.slice(0, 4));
  return AWARENESS_DAYS.filter((entry) =>
    entry.key === 'blackFriday' ? day === blackFriday(year) : entry.date === monthDay,
  );
}

function blackFriday(year: number): string {
  const first = new Date(Date.UTC(year, 10, 1));
  const firstThursday = 1 + ((4 - first.getUTCDay() + 7) % 7);
  return `${year}-11-${String(firstThursday + 22).padStart(2, '0')}`;
}
