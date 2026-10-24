import type { Season } from '../contracts';
/** Calendar protocol arithmetic, not operational limits. Preserves the legacy composition rules. */
export function adjustDaySlots(slots: Array<{ hour: number; minute: number }>, seasons: Season[], targetIds: readonly string[], day: string) {
 const active = seasons.filter(s => s.startsOn <= day && s.endsOn >= day && (!s.targetIds.length || !targetIds.length || s.targetIds.some(id => targetIds.includes(id))));
 if (active.some(s => s.rule === 'pause')) return [];
 const extra = active.filter(s => s.rule === 'more').flatMap(s => s.extraTimes.filter(t => /^([01]\d|2[0-3]):[0-5]\d$/.test(t)).map(t => { const [hour, minute] = t.split(':').map(Number); return { hour, minute }; }));
 const shift = active.filter(s => s.rule === 'shift').reduce((sum, s) => sum + s.shiftMinutes, 0);
 const fewer = active.some(s => s.rule === 'fewer');
 return [...new Set([...slots, ...extra].map(s => s.hour * 60 + s.minute))].sort((a, b) => a - b).filter((_, i) => !fewer || i % 2 === 0).map(t => t + shift).filter(t => t >= 0 && t < 24 * 60).map(t => ({ hour: Math.floor(t / 60), minute: t % 60 }));
}
export function keyDateOn(date: { date: string; yearly: boolean }, day: string) {
 return date.yearly ? date.date.slice(5) === day.slice(5) : date.date === day;
}
