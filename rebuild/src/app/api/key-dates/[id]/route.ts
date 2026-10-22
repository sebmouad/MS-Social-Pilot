import { calendarItemHttp } from '@/modules/calendar-extras/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const handler = calendarItemHttp('dates');
export { handler as PATCH, handler as DELETE };
