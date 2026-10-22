import { calendarCollectionHttp } from '@/modules/calendar-extras/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const handler = calendarCollectionHttp('trends');
export { handler as GET, handler as POST };
