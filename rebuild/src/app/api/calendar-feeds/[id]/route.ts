import { calendarItemHttp } from '@/modules/calendar-extras/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const handler = calendarItemHttp('feeds');
export { handler as DELETE };
